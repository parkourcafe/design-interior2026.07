\set ON_ERROR_STOP on
\if :{?r1_materialization_restart_check}
begin;
do $materialization_replay_check$
declare c r1_validation_fixture.context%rowtype; generation uuid; expected jsonb; result jsonb; before_counts jsonb; after_counts jsonb; before_ledger jsonb;
begin
 select * into strict c from r1_validation_fixture.context;
 select generation_id into strict generation from remhaos_integration.external_validation_completions where organization_id=c.organization_id and project_id=c.project_id and job_id=c.job_id;
 select logical_result into strict expected from remhaos_integration.command_records where organization_id=c.organization_id and project_id=c.project_id and operation='materialize_external_generation' and key_digest=project_intelligence._sha256_text('d-concurrent');
 perform remhaos_integration._assert_external_materialization(c.organization_id,c.project_id,c.project_id,generation);
 select to_jsonb(q) into strict before_ledger from remhaos_integration.external_upload_quota_ledgers q where organization_id=c.organization_id and project_id=c.project_id;
 select jsonb_build_object('intakes',(select count(*) from remhaos_integration.file_intakes),'assets',(select count(*) from projectceo_foundation.external_assets),'versions',(select count(*) from projectceo_foundation.external_asset_versions),'links',(select count(*) from remhaos_integration.external_generation_intake_links),'lineage',(select count(*) from remhaos_integration.external_asset_validation_lineage),'commands',(select count(*) from remhaos_integration.command_records)) into before_counts;
 result:=remhaos_integration._materialize_external_generation(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,generation,'d-concurrent');
 if result->>'replay' is distinct from 'true' or result->'result' is distinct from expected then raise exception 'MATERIALIZATION_RESTART_RECEIPT_CHANGED'; end if;
 select jsonb_build_object('intakes',(select count(*) from remhaos_integration.file_intakes),'assets',(select count(*) from projectceo_foundation.external_assets),'versions',(select count(*) from projectceo_foundation.external_asset_versions),'links',(select count(*) from remhaos_integration.external_generation_intake_links),'lineage',(select count(*) from remhaos_integration.external_asset_validation_lineage),'commands',(select count(*) from remhaos_integration.command_records)) into after_counts;
 if before_counts<>after_counts or before_ledger is distinct from (select to_jsonb(q) from remhaos_integration.external_upload_quota_ledgers q where organization_id=c.organization_id and project_id=c.project_id) then raise exception 'MATERIALIZATION_RESTART_DUPLICATED_EFFECT'; end if;
end $materialization_replay_check$;
commit;
select 'R1_MATERIALIZATION_EXACT_REPLAY_CHECK_OK' as result;
\else
begin;
-- A real late database failure, not a production bypass or fake receipt.
create function r1_validation_fixture.reject_materialization_command() returns trigger language plpgsql as $f$
begin if new.operation='materialize_external_generation' then raise sqlstate 'P9002' using message='SYNTHETIC_LATE_MATERIALIZATION_FAILURE'; end if; return new; end $f$;
create trigger r1_fixture_late_failure before insert on remhaos_integration.command_records for each row execute function r1_validation_fixture.reject_materialization_command();
do $late_failure$
declare c r1_validation_fixture.context%rowtype; generation uuid; before_ledger jsonb; before_counts jsonb; after_counts jsonb;
begin
 select * into strict c from r1_validation_fixture.context;
 select generation_id into strict generation from remhaos_integration.external_validation_completions where organization_id=c.organization_id and project_id=c.project_id and job_id=c.job_id;
 select to_jsonb(q) into strict before_ledger from remhaos_integration.external_upload_quota_ledgers q where organization_id=c.organization_id and project_id=c.project_id;
 select jsonb_build_object('intakes',(select count(*) from remhaos_integration.file_intakes),'assets',(select count(*) from projectceo_foundation.external_assets),'versions',(select count(*) from projectceo_foundation.external_asset_versions),'links',(select count(*) from remhaos_integration.external_generation_intake_links),'lineage',(select count(*) from remhaos_integration.external_asset_validation_lineage),'events',(select count(*) from projectceo_foundation.external_asset_events),'commands',(select count(*) from remhaos_integration.command_records)) into before_counts;
 begin
  perform remhaos_integration._materialize_external_generation(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,generation,'d-late-failure');
  raise exception 'MATERIALIZATION_LATE_FAILURE_NOT_REACHED';
 exception when sqlstate 'P9002' then null; end;
 select jsonb_build_object('intakes',(select count(*) from remhaos_integration.file_intakes),'assets',(select count(*) from projectceo_foundation.external_assets),'versions',(select count(*) from projectceo_foundation.external_asset_versions),'links',(select count(*) from remhaos_integration.external_generation_intake_links),'lineage',(select count(*) from remhaos_integration.external_asset_validation_lineage),'events',(select count(*) from projectceo_foundation.external_asset_events),'commands',(select count(*) from remhaos_integration.command_records)) into after_counts;
 if before_counts<>after_counts or before_ledger is distinct from (select to_jsonb(q) from remhaos_integration.external_upload_quota_ledgers q where organization_id=c.organization_id and project_id=c.project_id) then raise exception 'MATERIALIZATION_LATE_FAILURE_LEAKED'; end if;
end $late_failure$;
drop trigger r1_fixture_late_failure on remhaos_integration.command_records;
drop function r1_validation_fixture.reject_materialization_command();

do $materialization$
declare c r1_validation_fixture.context%rowtype; generation uuid; g remhaos_integration.external_upload_generations%rowtype; v remhaos_integration.external_validation_receipts%rowtype;
 result jsonb; replay jsonb; intake uuid; asset uuid; version uuid; ledger jsonb; legacy uuid; worker uuid; query text; fname text; key text; requests jsonb;
begin
 select * into strict c from r1_validation_fixture.context;
 select generation_id into strict generation from remhaos_integration.external_validation_completions where organization_id=c.organization_id and project_id=c.project_id and job_id=c.job_id;
 select * into strict g from remhaos_integration.external_upload_generations where organization_id=c.organization_id and project_id=c.project_id and generation_id=generation;
 select * into strict v from remhaos_integration.external_validation_receipts where organization_id=c.organization_id and project_id=c.project_id and receipt_id=c.validation_receipt_id;
 update project_intelligence.organization_members set status='inactive' where organization_id=c.organization_id and user_id=g.created_by_user_id;
 result:=remhaos_integration._materialize_external_generation(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,generation,'d-materialize');
 intake:=(result#>>'{result,intakeId}')::uuid; asset:=(result#>>'{result,assetId}')::uuid; version:=(result#>>'{result,assetVersionId}')::uuid;
 if intake<>g.intake_id then raise exception 'MATERIALIZATION_INTAKE_ID_CHANGED'; end if;
 if not exists(select 1 from remhaos_integration.file_intakes where intake_id=intake and r1_generation_id=generation and created_by_user_id=g.created_by_user_id and status='clean' and scan_outcome='clean' and review_decision is null and source_id is null and original_filename='external-'||intake::text||'.pdf') then raise exception 'MATERIALIZATION_INTAKE_IDENTITY_OR_APPROVAL'; end if;
 if not exists(select 1 from remhaos_integration.external_generation_intake_links where generation_id=generation and display_name_origin='generated') then raise exception 'MATERIALIZATION_GENERATED_LABEL_NOT_MARKED'; end if;
 if not exists(select 1 from projectceo_foundation.external_asset_versions where asset_version_id=version and asset_id=asset and server_sha256=v.source_sha256 and byte_length=v.byte_length and created_by_user_id=g.created_by_user_id) then raise exception 'MATERIALIZATION_ASSET_IDENTITY'; end if;
 select to_jsonb(q) into ledger from remhaos_integration.external_upload_quota_ledgers q where organization_id=c.organization_id and project_id=c.project_id;
 if ledger->>'logical_used'<>'100' or ledger->>'logical_reserved'<>'600' or ledger->>'physical_used'<>'100' or ledger->>'physical_reserved'<>'1800' or ledger->>'physical_orphan'<>'500' then raise exception 'MATERIALIZATION_ACCOUNTING_INCORRECT'; end if;
 replay:=remhaos_integration._materialize_external_generation(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,generation,'d-materialize');
 if replay->>'replay' is distinct from 'true' or replay->'result' is distinct from result->'result' or ledger is distinct from (select to_jsonb(q) from remhaos_integration.external_upload_quota_ledgers q where organization_id=c.organization_id and project_id=c.project_id) then raise exception 'MATERIALIZATION_REPLAY_DUPLICATED'; end if;
 begin
  insert into projectceo_foundation.external_asset_versions(organization_id,project_id,package_id,asset_id,asset_version_id,revision_no,server_sha256,byte_length,validated_format,private_storage_locator,origin_intake_generation,created_by_user_id)
  values(c.organization_id,c.project_id,c.project_id,asset,extensions.gen_random_uuid(),2,project_intelligence._sha256_text('different synthetic bytes'),25,'pdf','private/unlinked-synthetic',generation::text,g.created_by_user_id);
  set constraints projectceo_foundation.r1_asset_materialization_closure immediate;
  raise exception 'MATERIALIZATION_SECOND_UNLINKED_VERSION_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'R1_INSERTED_ASSET_VERSION_LINEAGE_MISSING' then raise; end if; end;
 begin
  update remhaos_integration.file_intakes set r1_generation_id=null where intake_id=intake;
  raise exception 'MATERIALIZATION_DISCRIMINATOR_CLEARED';
 exception when raise_exception then if sqlerrm<>'R1_INTAKE_DISCRIMINATOR_IMMUTABLE' then raise; end if; end;
 begin
  update remhaos_integration.file_intakes set checksum=project_intelligence._sha256_text('tampered') where intake_id=intake;
  raise exception 'MATERIALIZATION_CHECKSUM_MUTATED';
 exception when raise_exception then if sqlerrm<>'R1_INTAKE_MEASURED_IDENTITY_IMMUTABLE' then raise; end if; end;
 update project_intelligence.organization_members set status='active' where organization_id=c.organization_id and user_id=g.created_by_user_id;
 perform set_config('request.jwt.claim.sub',g.created_by_user_id::text,true);
 -- Same verified bytes create/reuse a separate legacy intake, never R1's row.
 result:=remhaos_integration_api.create_file_intake(c.project_id,'legacy.pdf','application/pdf','pdf',v.byte_length,encode(v.source_sha256,'hex'),'document','d-legacy-create');
 legacy:=(result#>>'{result,intakeId}')::uuid;
 if legacy=intake or not remhaos_integration._is_legacy_file_intake(c.organization_id,c.project_id,legacy) then raise exception 'MATERIALIZATION_LEGACY_DEDUP_REUSED_R1'; end if;
 replay:=remhaos_integration_api.create_file_intake(c.project_id,'legacy.pdf','application/pdf','pdf',v.byte_length,encode(v.source_sha256,'hex'),'document','d-legacy-create');
 if replay->>'replay' is distinct from 'true' then raise exception 'MATERIALIZATION_LEGACY_REPLAY_CHANGED'; end if;
 result:=remhaos_integration_api.create_file_intake_worker(c.project_id,'legacy-worker.pdf','application/pdf','pdf',v.byte_length,encode(v.source_sha256,'hex'),'document','d-legacy-worker');
 worker:=(result#>>'{result,intakeId}')::uuid;
 if worker<>legacy then raise exception 'MATERIALIZATION_LEGACY_PROJECT_DEDUP_CHANGED'; end if;
 -- Every legacy ID-based path refuses R1 before replay, mutation or projection.
 foreach query in array array[
  format('select remhaos_integration_api.mark_file_intake_uploaded(%L::uuid,%L::uuid,%L)',c.project_id,intake,'d-old-mark'),
  format('select remhaos_integration_api.mark_file_intake_uploaded_worker(%L::uuid,%L::uuid,%L)',c.project_id,intake,'d-old-worker-mark'),
  format('select remhaos_integration_api.complete_file_intake_scan(%L::uuid,%L::uuid,%L,%L)',c.project_id,intake,'clean','d-old-scan'),
  format('select remhaos_integration_api.review_file_intake(%L::uuid,%L::uuid,%L,%L,%L)',c.project_id,intake,'accepted','synthetic forbidden review','d-old-review'),
  format('select remhaos_integration_api.publish_file_intake(%L::uuid,%L::uuid,%L)',c.project_id,intake,'d-old-publish'),
  format('select remhaos_integration_api.get_file_intake_storage(%L::uuid,%L::uuid)',c.project_id,intake),
  format('select remhaos_integration_api.authorize_file_intake_download(%L::uuid,%L::uuid,300)',c.project_id,intake)
 ] loop
  begin execute query; raise exception 'MATERIALIZATION_LEGACY_PATH_ACCEPTED_R1'; exception when sqlstate 'P1204' then null; end;
 end loop;
 if remhaos_integration_api.list_file_intakes(c.project_id)::text like '%'||intake::text||'%' then raise exception 'MATERIALIZATION_LEGACY_LIST_LEAKED_R1'; end if;
 -- Even a forged/future published projection cannot bypass stored classification.
 begin
  update remhaos_integration.file_intakes set status='published_internal_copy' where intake_id=intake;
  begin perform remhaos_integration_api.get_file_intake_storage(c.project_id,intake); raise exception 'MATERIALIZATION_PUBLISHED_STORAGE_LEAKED'; exception when sqlstate 'P1204' then null; end;
  begin perform remhaos_integration_api.authorize_file_intake_download(c.project_id,intake,300); raise exception 'MATERIALIZATION_PUBLISHED_DOWNLOAD_LEAKED'; exception when sqlstate 'P1204' then null; end;
  perform set_config('request.jwt.claim.sub','32222222-2222-4222-8222-222222222222',true);
  if remhaos_integration_api.list_file_intakes(c.project_id)::text like '%'||intake::text||'%' then raise exception 'MATERIALIZATION_CLIENT_LIST_LEAKED_R1'; end if;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
 -- Cache corruption fixture: guarded create replay never returns an R1 locator.
 foreach fname in array array['create_file_intake','create_file_intake_worker'] loop
  key:='d-poison-'||fname;
  requests:=jsonb_build_object('extension','pdf','filename','poison.pdf','mediaType','application/pdf','projectId',c.project_id,'role','document','sizeBytes',v.byte_length,'checksum',encode(v.source_sha256,'hex'));
  perform remhaos_integration._complete_command(c.organization_id,c.project_id,fname,project_intelligence._sha256_text(key),project_intelligence._sha256_jsonb(requests),'system','system:synthetic-cache',null,jsonb_build_object('intakeId',intake,'objectKey','private/never-return-this'),'synthetic_cache_fixture','ok','{}');
  begin
   execute format('select remhaos_integration_api.%I($1,$2,$3,$4,$5,$6,$7,$8)',fname) using c.project_id,'poison.pdf','application/pdf','pdf',v.byte_length,encode(v.source_sha256,'hex'),'document',key;
   raise exception 'MATERIALIZATION_POISONED_LEGACY_REPLAY_RETURNED_R1';
  exception when sqlstate 'P1204' then null; end;
 end loop;
 -- Genuine legacy PDF workflow remains the existing native publication path.
 perform remhaos_integration_api.mark_file_intake_uploaded(c.project_id,legacy,'d-legacy-mark');
 perform remhaos_integration_api.complete_file_intake_scan(c.project_id,legacy,'clean','d-legacy-scan');
 perform remhaos_integration_api.review_file_intake(c.project_id,legacy,'accepted','synthetic legacy review','d-legacy-review');
 perform remhaos_integration_api.publish_file_intake(c.project_id,legacy,'d-legacy-publish');
 result:=remhaos_integration_api.get_file_intake_storage(c.project_id,legacy);
 if result->>'status'<>'published_internal_copy' or result->>'objectKey' is distinct from result->>'internalObjectKey' then raise exception 'MATERIALIZATION_LEGACY_PUBLISHED_STORAGE_REGRESSED'; end if;
 perform remhaos_integration_api.authorize_file_intake_download(c.project_id,legacy,300);
 if has_function_privilege('authenticated','remhaos_integration._materialize_external_generation(uuid,text,uuid,uuid,uuid,uuid,text)','EXECUTE') or has_table_privilege('service_role','remhaos_integration.external_asset_validation_lineage','INSERT') then raise exception 'MATERIALIZATION_RUNTIME_EXPOSED'; end if;
 set constraints all immediate;
end $materialization$;
-- Type/profile/lineage matrix only: these explicit synthetic receipts do not
-- establish real AV, parser, conversion, geometry or provider acceptance.
do $format_matrix$
#variable_conflict use_variable
<<matrix_vars>>
declare
 c r1_validation_fixture.context%rowtype; b remhaos_integration.external_upload_policy_bindings%rowtype;
 binding uuid:=extensions.gen_random_uuid(); f record; upload jsonb; claim_result jsonb; materialized jsonb;
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
  ) matrix(format,extension,media_type,source_kind,profile) loop
   payload:=rpad(f.format,12,'_'); digest:=project_intelligence._sha256_text(payload);
   upload:=remhaos_integration._begin_external_upload(c.project_id,c.project_id,f.format,octet_length(payload),'supplied-'||f.format||'.label','d-format-upload-'||f.format);
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
   claim_result:=remhaos_integration._claim_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,f.profile,lease_secret,'d-format-claim-'||f.format);
   select x.attempt_started_at into strict started_at from remhaos_integration.external_validation_jobs x where x.job_id=matrix_vars.job_id;
   insert into remhaos_integration.external_validation_receipts(organization_id,project_id,package_id,receipt_id,job_id,generation_id,attempt,fence,object_identity_digest,outcome,source_sha256,byte_length,validated_format,validation_profile,policy_binding_id,structure_policy_version,structure_result,av_outcome,scanner_adapter_version,engine_version,executable_sha256,signature_version,signature_bundle_sha256,signature_policy_version,scan_started_at,scan_completed_at,sandbox_attestation_reference,sandbox_evidence_digest,completion_request_id,scanner_policy_version,sandbox_policy_version)
   values(c.organization_id,c.project_id,c.project_id,receipt_id,job_id,generation_id,1,1,project_intelligence._sha256_text('synthetic object '||generation_id),'successful',digest,octet_length(payload),f.format,f.profile,binding,'synthetic structure '||f.profile,'valid','clean','synthetic-adapter/1','1.0.0',project_intelligence._sha256_text('synthetic executable'),1,project_intelligence._sha256_text('synthetic signatures'),b.signature_policy_version,started_at,clock_timestamp(),'synthetic:format-sandbox',project_intelligence._sha256_text('synthetic sandbox evidence'),extensions.gen_random_uuid(),b.scanner_policy_version,b.sandbox_policy_version);
   insert into remhaos_integration.external_canonical_object_receipts values(c.organization_id,c.project_id,c.project_id,canonical_id,generation_id,receipt_id,project_intelligence._sha256_text('synthetic canonical '||generation_id),'private/format-canonical-'||generation_id,digest,octet_length(payload),b.storage_policy_version,project_intelligence._sha256_text('synthetic verification '||f.format),clock_timestamp());
   perform remhaos_integration._complete_external_validation_job(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,job_id,1,1,lease_secret,receipt_id,canonical_id,'d-format-complete-'||f.format);
   materialized:=remhaos_integration._materialize_external_generation(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,generation_id,'d-format-materialize-'||f.format);
   if not exists(select 1 from remhaos_integration.file_intakes i join remhaos_integration.external_generation_intake_links l on l.organization_id=i.organization_id and l.project_id=i.project_id and l.package_id=i.package_id and l.intake_id=i.intake_id join remhaos_integration.external_asset_validation_lineage a on a.organization_id=l.organization_id and a.project_id=l.project_id and a.package_id=l.package_id and a.generation_id=l.generation_id join projectceo_foundation.external_asset_versions av on av.organization_id=a.organization_id and av.project_id=a.project_id and av.package_id=a.package_id and av.asset_version_id=a.asset_version_id join projectceo_foundation.external_assets asset on asset.organization_id=av.organization_id and asset.project_id=av.project_id and asset.package_id=av.package_id and asset.asset_id=av.asset_id where i.intake_id=matrix_vars.intake_id and i.r1_generation_id=matrix_vars.generation_id and i.extension=f.extension and i.media_type=f.media_type and i.source_role='document' and i.checksum=digest and i.size_bytes=octet_length(payload) and i.original_filename='supplied-'||f.format||'.label' and l.display_name_origin='supplied' and av.validated_format=f.format and av.server_sha256=digest and asset.source_kind=f.source_kind) then raise exception 'MATERIALIZATION_FORMAT_MAPPING_FAILED: %',f.format; end if;
   raise notice 'R1_MATERIALIZATION_FORMAT_OK %',f.format;
  end loop;
  set constraints all immediate;
  raise sqlstate 'P9001';
 exception when sqlstate 'P9001' then null; end;
end $format_matrix$;
rollback;
select 'DB4_R1_MATERIALIZATION_LEGACY_ISOLATION_OK' as result;

\if :{?r1_materialization_concurrency}
do $fresh_materialization$ begin if exists(select 1 from remhaos_integration.external_generation_intake_links) then raise exception 'MATERIALIZATION_RACE_FIXTURE_NOT_FRESH'; end if; end $fresh_materialization$;
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-d-materialize-1'"'"'"'"'"'"'"'"'; begin; select remhaos_integration._materialize_external_generation(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,m.generation_id,'"'"'"'"'"'"'"'"'d-concurrent'"'"'"'"'"'"'"'"') from r1_validation_fixture.context c join remhaos_integration.external_validation_completions m on m.organization_id=c.organization_id and m.project_id=c.project_id and m.job_id=c.job_id; select pg_sleep(3); commit;'"'"' > /tmp/r1-d-materialize-1.log 2>&1 & first=$!; for i in $(seq 1 20); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-d-materialize-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.05; done; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-d-materialize-2'"'"'"'"'"'"'"'"'; begin; select remhaos_integration._materialize_external_generation(c.principal_id,c.principal_secret,c.organization_id,c.project_id,c.project_id,m.generation_id,'"'"'"'"'"'"'"'"'d-concurrent'"'"'"'"'"'"'"'"') from r1_validation_fixture.context c join remhaos_integration.external_validation_completions m on m.organization_id=c.organization_id and m.project_id=c.project_id and m.job_id=c.job_id; commit;'"'"' > /tmp/r1-d-materialize-2.log 2>&1 & second=$!; overlap=f; for i in $(seq 1 20); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-d-materialize-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-d-materialize-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"')'"'"'); [ "$overlap" = t ] && break; sleep 0.05; done; printf "%s\n" "$overlap" > /tmp/r1-d-materialize-overlap; wait "$first"; a=$?; wait "$second"; b=$?; printf "%s %s\n" "$a" "$b" > /tmp/r1-d-materialize-exits'
do $materialization_race$ begin
 if btrim(pg_read_file('/tmp/r1-d-materialize-overlap'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-d-materialize-exits'),E' \n\r\t')<>'0 0' then raise exception 'MATERIALIZATION_CONCURRENT_LOCK_PROOF_FAILED'; end if;
 if (select count(*) from remhaos_integration.command_records where operation='materialize_external_generation' and key_digest=project_intelligence._sha256_text('d-concurrent'))<>1 or (select count(*) from remhaos_integration.external_generation_intake_links)<>1 or (select count(*) from remhaos_integration.external_asset_validation_lineage)<>1 then raise exception 'MATERIALIZATION_CONCURRENT_DUPLICATE_EFFECT'; end if;
end $materialization_race$;
select 'R1_MATERIALIZATION_CONCURRENT_LOCK_OVERLAP_OK' as result;
\endif
\endif
