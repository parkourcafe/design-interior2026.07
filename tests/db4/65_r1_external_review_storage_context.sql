\set ON_ERROR_STOP on
begin;
set local request.jwt.claim.sub='31111111-1111-4111-8111-111111111111';
do $reference_regressions$
declare
 p uuid:='41111111-1111-4111-8111-111111111111'; a uuid:='31111111-1111-4111-8111-111111111111';
 o uuid; asset uuid:=extensions.gen_random_uuid(); av uuid:=extensions.gen_random_uuid(); bv uuid:=extensions.gen_random_uuid();
 t uuid:=extensions.gen_random_uuid(); s uuid:=extensions.gen_random_uuid(); snapshot jsonb; descriptor jsonb; content jsonb;
 leaf boolean; cross_kind boolean; accepted integer:=0; sheet text; revision text;
begin
 select organization_id into o from project_intelligence.project_workflows where project_id=p;
 select sheet_id,revision_id into strict sheet,revision from projectceo_m3.documentation_sheet_revisions where organization_id=o and project_id=p and package_id=p order by sheet_id,revision_id limit 1;
 insert into projectceo_foundation.external_assets(organization_id,project_id,package_id,asset_id,source_kind,created_by_user_id) values(o,p,p,asset,'pdf',a);
 insert into projectceo_foundation.external_asset_versions(organization_id,project_id,package_id,asset_id,asset_version_id,revision_no,server_sha256,byte_length,validated_format,private_storage_locator,origin_intake_generation,created_by_user_id)
 values(o,p,p,asset,av,1,decode(repeat('a',64),'hex'),100,'pdf','private/synthetic-r109-a','synthetic',a),
 (o,p,p,asset,bv,2,decode(repeat('b',64),'hex'),100,'pdf','private/synthetic-r109-b','synthetic',a);
 descriptor:=projectceo_foundation.resolve_r1_external_release_attachment_ref(o,p,p,jsonb_build_object('kind','asset_version','assetVersionId',av));
 snapshot:=jsonb_build_object('schemaVersion','archidom.external-file-review-subject/0.1','purpose','file_review','organizationId',o,'projectId',p,'packageId',p,'refs',jsonb_build_array(descriptor));
 insert into projectceo_foundation.external_review_subject_heads(organization_id,project_id,package_id,review_thread_id) values(o,p,p,t);
 insert into projectceo_foundation.external_review_submissions(organization_id,project_id,package_id,submission_id,review_thread_id,purpose,submission_revision,subject_digest,snapshot_schema_version,semantic_snapshot,assigned_client_user_id,submitted_by_user_id,reason)
 values(o,p,p,s,t,'file_review',1,project_intelligence._sha256_jsonb(snapshot),'archidom.external-file-review-subject/0.1',snapshot,a,a,'synthetic ref storage');
 foreach leaf in array array[false,true] loop
  content:=case when leaf then descriptor->'semanticContent' else descriptor end;
  foreach cross_kind in array array[false,true] loop
   begin
    insert into projectceo_foundation.external_review_submission_refs(organization_id,project_id,package_id,submission_id,ordinal,ref_kind,ref_identity,asset_version_id,sheet_id,sheet_revision_id,semantic_content,semantic_digest)
    values(o,p,p,s,0,case when cross_kind then 'documentation_sheet_revision' else 'asset_version' end,descriptor->>'refIdentity',case when cross_kind then null else bv end,case when cross_kind then sheet end,case when cross_kind then revision end,content,project_intelligence._sha256_jsonb(content));
    raise sqlstate 'P9001' using message='REF_SUBSTITUTION_ACCEPTED';
   exception when raise_exception then if sqlerrm<>'REVIEW_REF_MISMATCH' then raise; end if;
    when sqlstate 'P9001' then accepted:=accepted+1; raise notice 'R109_RED_REF leaf=%, cross_kind=%',leaf,cross_kind;
   end;
  end loop;
 end loop;
 if accepted<>0 then raise exception 'R109_REF_SUBSTITUTIONS_ACCEPTED: %',accepted; end if;
 -- Candidate-compatible positive: the normalized row contains the leaf and its
 -- digest, while the snapshot contains the resolver's complete descriptor.
 insert into projectceo_foundation.external_review_submission_refs(organization_id,project_id,package_id,submission_id,ordinal,ref_kind,ref_identity,asset_version_id,semantic_content,semantic_digest)
 values(o,p,p,s,0,descriptor->>'refKind',descriptor->>'refIdentity',av,descriptor->'semanticContent',decode(substr(descriptor->>'semanticDigest',8),'hex'));
 if not exists(select 1 from projectceo_foundation.external_review_submission_refs where submission_id=s and semantic_content=descriptor->'semanticContent' and semantic_digest=project_intelligence._sha256_jsonb(descriptor->'semanticContent')) then raise exception 'R109_LEAF_CONVENTION_MISSING'; end if;
end $reference_regressions$;

-- Record private facts as the fixture owner, then exercise the API only under
-- the authenticated role. The authenticated block must not query private
-- tables directly.
do $subject_preview_prepare$
declare
 p uuid:='41111111-1111-4111-8111-111111111111'; asset_version uuid;
 before_counts jsonb;
begin
 select asset_version_id into strict asset_version
 from projectceo_foundation.external_asset_versions
 where project_id=p and package_id=p order by created_at limit 1;
 select jsonb_build_object('heads',(select count(*) from projectceo_foundation.external_review_subject_heads),
   'submissions',(select count(*) from projectceo_foundation.external_review_submissions),
   'refs',(select count(*) from projectceo_foundation.external_review_submission_refs),
   'designDecisions',(select count(*) from projectceo_foundation.external_review_design_decisions),
   'technicalDecisions',(select count(*) from projectceo_foundation.external_review_technical_decisions),
   'events',(select count(*) from projectceo_foundation.external_review_events),
   'commands',(select count(*) from projectceo_product.command_records)) into before_counts;
 perform set_config('r109.preview_asset_version_id',asset_version::text,true);
 perform set_config('r109.preview_before_counts',before_counts::text,true);
end $subject_preview_prepare$;

set local role authenticated;
do $subject_preview$
declare
 p uuid:='41111111-1111-4111-8111-111111111111'; asset_version uuid;
 r jsonb;
begin
 asset_version:=current_setting('r109.preview_asset_version_id')::uuid;
 r:=projectceo_product_api.preview_external_review_subject(p,p,jsonb_build_array(jsonb_build_object('kind','asset_version','assetVersionId',asset_version)));
 if r->'error' <> 'null'::jsonb
   or r#>>'{data,purpose}' is distinct from 'file_review'
   or r#>>'{data,releaseEligibility}' is distinct from 'ineligible_file_review'
   or jsonb_array_length(r#>'{data,safeExactRefs}')<>1
   or r::text like '%assetVersionId%'
   or r::text like '%private/synthetic%' then
   raise exception 'R109_PREVIEW_UNSAFE_OR_INVALID';
 end if;
 if exists (
  select 1 from jsonb_array_elements(r#>'{data,safeExactRefs}') item
  where (select count(*) from jsonb_object_keys(item))<>3
    or not (item ?& array['ordinal','kind','digest'])
    or jsonb_typeof(item->'ordinal') is distinct from 'number'
    or jsonb_typeof(item->'kind') is distinct from 'string'
    or jsonb_typeof(item->'digest') is distinct from 'string'
 ) then raise exception 'R109_PREVIEW_REF_DESCRIPTOR_LEAK'; end if;
 begin
  perform projectceo_product_api.preview_external_review_subject(p,p,jsonb_build_array(
    jsonb_build_object('kind','asset_version','assetVersionId',asset_version),
    jsonb_build_object('kind','asset_version','assetVersionId',asset_version)
  ));
  raise exception 'R109_PREVIEW_DUPLICATE_ACCEPTED';
 exception when sqlstate 'P1111' then null; end;
 begin
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  perform projectceo_product_api.preview_external_review_subject(p,p,jsonb_build_array(jsonb_build_object('kind','asset_version','assetVersionId',asset_version)));
  raise exception 'R109_PREVIEW_FOREIGN_TENANT_ALLOWED';
 exception when sqlstate 'P1103' then null; end;
 perform set_config('request.jwt.claim.sub','31111111-1111-4111-8111-111111111111',true);
 begin
  perform projectceo_product_api.preview_external_review_subject(p,'49999999-9999-4999-8999-999999999999',jsonb_build_array(jsonb_build_object('kind','asset_version','assetVersionId',asset_version)));
  raise exception 'R109_PREVIEW_CROSS_PACKAGE_ALLOWED';
 exception when sqlstate 'P1104' then null; end;
end $subject_preview$;
reset role;

do $subject_preview_no_persistence$
declare after_counts jsonb;
begin
 select jsonb_build_object('heads',(select count(*) from projectceo_foundation.external_review_subject_heads),
   'submissions',(select count(*) from projectceo_foundation.external_review_submissions),
   'refs',(select count(*) from projectceo_foundation.external_review_submission_refs),
   'designDecisions',(select count(*) from projectceo_foundation.external_review_design_decisions),
   'technicalDecisions',(select count(*) from projectceo_foundation.external_review_technical_decisions),
   'events',(select count(*) from projectceo_foundation.external_review_events),
   'commands',(select count(*) from projectceo_product.command_records)) into after_counts;
 if after_counts is distinct from current_setting('r109.preview_before_counts')::jsonb then raise exception 'R109_PREVIEW_PERSISTED'; end if;
end $subject_preview_no_persistence$;

do $fixture$
declare
 p uuid:='41111111-1111-4111-8111-111111111111'; a uuid:='31111111-1111-4111-8111-111111111111';
 o uuid; t uuid:=extensions.gen_random_uuid(); s uuid:=extensions.gen_random_uuid(); t_unassigned uuid:=extensions.gen_random_uuid(); s_unassigned uuid:=extensions.gen_random_uuid(); c record; c2 record; snap jsonb; dig bytea; r jsonb; before_state bigint; decision_json jsonb; dt timestamptz:=statement_timestamp(); bad_disclosure jsonb; bad_json jsonb; typ text; null_accepted integer:=0;
begin
 select organization_id,state_revision into o,before_state from project_intelligence.project_workflows where project_id=p;
 snap:=jsonb_build_object('schemaVersion','archidom.external-file-review-subject/0.1','purpose','file_review','organizationId',o,'projectId',p,'packageId',p,'refs','[]'::jsonb);
 dig:=project_intelligence._sha256_jsonb(snap);
 insert into projectceo_foundation.external_review_subject_heads(organization_id,project_id,package_id,review_thread_id) values(o,p,p,t);
 insert into projectceo_foundation.external_review_submissions(organization_id,project_id,package_id,submission_id,review_thread_id,purpose,submission_revision,subject_digest,snapshot_schema_version,semantic_snapshot,assigned_client_user_id,submitted_by_user_id,reason)
 values(o,p,p,s,t,'file_review',1,dig,'archidom.external-file-review-subject/0.1',snap,'32222222-2222-4222-8222-222222222222',a,'synthetic storage fixture, not ready review');
 update projectceo_foundation.external_review_subject_heads set current_submission_id=s,lifecycle_revision=1 where review_thread_id=t;
 begin
  update projectceo_foundation.external_review_submissions set assigned_client_user_id='32222222-2222-4222-8222-222222222222' where submission_id=s;
  raise exception 'append-only guard absent';
 exception when sqlstate '55000' then null; end;
 begin
  insert into projectceo_foundation.external_review_submissions(organization_id,project_id,package_id,submission_id,review_thread_id,purpose,submission_revision,subject_digest,snapshot_schema_version,semantic_snapshot,assigned_client_user_id,submitted_by_user_id,reason)
  values(o,p,p,extensions.gen_random_uuid(),t,'file_review',2,decode(repeat('a',64),'hex'),'archidom.external-file-review-subject/0.1',snap,a,a,'bad digest');
  raise exception 'digest accepted';
 exception when check_violation then null; end;
 begin
  perform projectceo_foundation._external_review_lock_subject(o,p,p,t,s,1,dig,0);
  raise exception 'stale head accepted';
 exception when sqlstate 'P1107' then null; end;
 perform projectceo_foundation._external_review_lock_subject(o,p,p,t,s,1,dig,1);
 -- Synthetic storage-only typed evidence, no public command/human approval.
 decision_json:=jsonb_build_object('schemaVersion','archidom.external-review-decision/0.1','purpose','file_review','snapshotSchemaVersion','archidom.external-file-review-subject/0.1','organizationId',o,'projectId',p,'packageId',p,'submissionId',s,'submissionRevision',1,'subjectDigest','sha256:'||encode(dig,'hex'),'approvalType','TECHNICALLY_REVIEWED','decision','rejected','reason','synthetic','initiatedByUserId',a,'decidedByUserId',a,'decidedAt',dt,'selfApproved',true,'authorshipDisclosure','{"independenceStatus":"unknown"}'::jsonb);
 -- SQL CHECK must reject JSON null, missing, non-string and unknown states.
 foreach typ in array array['technical','design'] loop
  for bad_disclosure in select value from jsonb_array_elements('[{"independenceStatus":null},{},{"independenceStatus":1},{"independenceStatus":"other"}]'::jsonb) loop
   bad_json := decision_json || jsonb_build_object('authorshipDisclosure',bad_disclosure);
   if typ='design' then bad_json := bad_json || jsonb_build_object('approvalType','CLIENT_APPROVED','decidedByUserId','32222222-2222-4222-8222-222222222222','selfApproved',false); end if;
   begin
    execute format('insert into projectceo_foundation.external_review_%I_decisions (organization_id,project_id,package_id,submission_id,subject_digest,submission_revision,decision,reason,initiated_by_user_id,decided_by_user_id,decided_at,self_approved,authorship_disclosure,semantic_content,semantic_digest) values ($1,$2,$2,$3,$4,1,''rejected'',''synthetic'',$5,$6,$7,$8,$9,$10,$11)',typ)
    using o,p,s,dig,a,(bad_json->>'decidedByUserId')::uuid,dt,(bad_json->>'selfApproved')::boolean,bad_disclosure,bad_json,project_intelligence._sha256_jsonb(bad_json);
    -- Roll successful insertion back so every branch is exercised on red runs.
    raise sqlstate 'P9001' using message='INVALID_DISCLOSURE_ACCEPTED';
   exception when check_violation then null;
    when sqlstate 'P9001' then null_accepted:=null_accepted+1; raise notice 'R109_RED_%: %',typ,bad_disclosure;
   end;
  end loop;
 end loop;
 if null_accepted<>0 then raise exception 'R109_INVALID_DISCLOSURES_ACCEPTED: %',null_accepted; end if;
 insert into projectceo_foundation.external_review_technical_decisions(organization_id,project_id,package_id,submission_id,subject_digest,submission_revision,decision,reason,initiated_by_user_id,decided_by_user_id,decided_at,self_approved,authorship_disclosure,semantic_content,semantic_digest)
 values(o,p,p,s,dig,1,'rejected','synthetic',a,a,dt,true,'{"independenceStatus":"unknown"}',decision_json,project_intelligence._sha256_jsonb(decision_json));
 begin
  insert into projectceo_foundation.external_review_design_decisions(organization_id,project_id,package_id,submission_id,subject_digest,submission_revision,decision,reason,initiated_by_user_id,decided_by_user_id,decided_at,self_approved,authorship_disclosure,semantic_content,semantic_digest)
  values(o,p,p,s,dig,1,'rejected','synthetic',a,a,dt,true,'{"independenceStatus":"unknown"}',jsonb_set(decision_json,'{approvalType}','"CLIENT_APPROVED"'),project_intelligence._sha256_jsonb(jsonb_set(decision_json,'{approvalType}','"CLIENT_APPROVED"')));
  raise exception 'design self decision accepted';
 exception when check_violation then null; end;
 begin
  insert into projectceo_foundation.external_review_subject_heads(organization_id,project_id,package_id) values(o,p,extensions.gen_random_uuid());
  raise exception 'cross package accepted';
 exception when foreign_key_violation then null; end;
 begin
  update projectceo_foundation.external_review_subject_heads set review_thread_id=extensions.gen_random_uuid() where review_thread_id=t;
  raise exception 'head origin mutation accepted';
 exception when raise_exception then if sqlerrm<>'REVIEW_THREAD_SCOPE_IMMUTABLE' then raise; end if; end;
 -- Two typed slots retain the same subject/lifecycle and distinct event order.
 decision_json:=decision_json || jsonb_build_object('approvalType','CLIENT_APPROVED','decidedByUserId','32222222-2222-4222-8222-222222222222','selfApproved',false);
 insert into projectceo_foundation.external_review_design_decisions(organization_id,project_id,package_id,submission_id,subject_digest,submission_revision,decision,reason,initiated_by_user_id,decided_by_user_id,decided_at,self_approved,authorship_disclosure,semantic_content,semantic_digest)
 values(o,p,p,s,dig,1,'rejected','synthetic',a,'32222222-2222-4222-8222-222222222222',dt,false,'{"independenceStatus":"unknown"}',decision_json,project_intelligence._sha256_jsonb(decision_json));
 insert into projectceo_foundation.external_review_events(organization_id,project_id,package_id,review_thread_id,submission_id,lifecycle_revision,event_sequence,event_kind,actor_user_id,reason,design_decision_id,decision_digest)
 select o,p,p,t,s,1,1,'design_decided',decided_by_user_id,'synthetic',decision_id,semantic_digest from projectceo_foundation.external_review_design_decisions where submission_id=s;
 insert into projectceo_foundation.external_review_events(organization_id,project_id,package_id,review_thread_id,submission_id,lifecycle_revision,event_sequence,event_kind,actor_user_id,reason,technical_decision_id,decision_digest)
 select o,p,p,t,s,1,2,'technical_decided',a,'synthetic',decision_id,semantic_digest from projectceo_foundation.external_review_technical_decisions where submission_id=s;
 update projectceo_foundation.external_review_subject_heads set last_event_sequence=2 where review_thread_id=t;
 perform projectceo_foundation._external_review_lock_subject(o,p,p,t,s,1,dig,1);
 -- Unrelated global advancement does not stale review subject CAS.
 update project_intelligence.project_workflows set state_revision=state_revision+1 where project_id=p;
 select * into c from projectceo_foundation._external_review_command_context(p,p,'submit_external_review',null,'r109-storage-context','{"reason":"synthetic"}');
 if c.state_revision<>before_state+1 then raise exception 'server state not current'; end if;
 perform projectceo_foundation._external_review_lock_subject(o,p,p,t,s,1,dig,1);
 begin
  perform set_config('projectceo.product_test_fail_after_domain','on',true);
  insert into projectceo_foundation.external_review_events(organization_id,project_id,package_id,review_thread_id,submission_id,lifecycle_revision,event_sequence,event_kind,actor_user_id,reason,new_submission_id)
  values(o,p,p,t,s,1,3,'submitted',a,'synthetic rollback',s);
  update projectceo_foundation.external_review_subject_heads set last_event_sequence=last_event_sequence+1 where review_thread_id=t;
  perform projectceo_foundation._external_review_complete_command(o,p,'submit_external_review',c.key_digest,c.request_digest,a,'{}','{}',c.state_revision);
  raise exception 'audit injection did not fail';
 exception when sqlstate 'P1112' then null; end;
 perform set_config('projectceo.product_test_fail_after_domain','off',true);
 if (select count(*) from projectceo_foundation.external_review_events where review_thread_id=t)<>2 or (select last_event_sequence from projectceo_foundation.external_review_subject_heads where review_thread_id=t)<>2 or exists(select 1 from projectceo_product.command_records where key_digest=c.key_digest and operation='submit_external_review') then raise exception 'audit rollback leaked'; end if;
 r:=projectceo_foundation._external_review_complete_command(o,p,'submit_external_review',c.key_digest,c.request_digest,a,'{"fixture":true}','{}',c.state_revision);
 select * into c2 from projectceo_foundation._external_review_command_context(p,p,'submit_external_review',null,'r109-storage-context','{"reason":"synthetic"}');
 if c2.replay is null or c2.replay->>'replay'<>'true' then raise exception 'replay missing'; end if;
 begin
  perform projectceo_foundation._external_review_command_context(p,p,'submit_external_review',null,'r109-storage-context','{"reason":"altered"}');
  raise exception 'changed reason replay accepted';
 exception when sqlstate 'P1108' then null; end;
 begin
  delete from projectceo_foundation.project_member_capabilities where organization_id=o and project_id=p and user_id=a and capability='prepare_client_handoff';
  delete from projectceo_foundation.package_member_capabilities where organization_id=o and project_id=p and package_id=p and user_id=a and capability='prepare_client_handoff';
  perform projectceo_foundation._external_review_command_context(p,p,'submit_external_review',null,'r109-storage-context','{"reason":"synthetic"}');
  raise exception 'revoked replay accepted';
 exception when sqlstate 'P1103' then null; end;
 if has_table_privilege('service_role','projectceo_foundation.external_review_submissions','INSERT') or has_function_privilege('authenticated','projectceo_foundation._external_review_command_context(uuid,uuid,text,text,text,jsonb)','EXECUTE') then raise exception 'private foundation exposed'; end if;
 -- The read door is scoped to this exact submission and returns opaque ref
 -- summaries only. It does not turn storage evidence into a release result.
 r := projectceo_read_api.get_external_review(p,p,s);
 if r->'error' <> 'null'::jsonb
   or r#>>'{data,submissionId}' is distinct from s::text
   or r#>>'{data,purpose}' is distinct from 'file_review'
   or r#>>'{data,releaseEligibility}' is distinct from 'ineligible_file_review'
   or r#>>'{data,reviewReadiness}' is distinct from 'not_evaluated'
   or r::text like '%private/synthetic%'
   or r::text like '%32222222-2222-4222-8222-222222222222%'
   or r::text like '%assignedClientUserId%' then
   raise exception 'R109_READ_SCOPE_OR_SANITIZATION';
 end if;
 insert into projectceo_foundation.external_review_subject_heads(organization_id,project_id,package_id,review_thread_id)
 values(o,p,p,t_unassigned);
 insert into projectceo_foundation.external_review_submissions(organization_id,project_id,package_id,submission_id,review_thread_id,purpose,submission_revision,subject_digest,snapshot_schema_version,semantic_snapshot,assigned_client_user_id,submitted_by_user_id,reason)
 values(o,p,p,s_unassigned,t_unassigned,'file_review',1,dig,'archidom.external-file-review-subject/0.1',snap,a,a,'synthetic unassigned-client read fixture');
 update projectceo_foundation.external_review_subject_heads
 set current_submission_id=s_unassigned,lifecycle_revision=1 where review_thread_id=t_unassigned;
 perform set_config('r109.assigned_submission_id',s::text,true);
 perform set_config('r109.unassigned_submission_id',s_unassigned::text,true);
end $fixture$;

-- These are actual authenticated identities, not an owner-shaped call under
-- the test superuser. Builder and unassigned-client reads must be denied.
update projectceo_foundation.project_memberships
set role='builder' where project_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';
update projectceo_foundation.package_memberships
set role='builder' where project_id='41111111-1111-4111-8111-111111111111'
  and package_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $builder_read_denied$
declare r jsonb;
begin
 r:=projectceo_read_api.get_external_review('41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',current_setting('r109.assigned_submission_id')::uuid);
 if r#>>'{error,code}' is distinct from 'forbidden' or r->'data' is distinct from 'null'::jsonb then raise exception 'R109_BUILDER_READ_ALLOWED'; end if;
end $builder_read_denied$;
reset role;
update projectceo_foundation.project_memberships
set role='client_approver' where project_id='41111111-1111-4111-8111-111111111111'
  and user_id='32222222-2222-4222-8222-222222222222';
insert into projectceo_foundation.package_memberships(organization_id,project_id,package_id,user_id,role)
select organization_id,project_id,project_id,'32222222-2222-4222-8222-222222222222','client_approver'
from project_intelligence.project_workflows where project_id='41111111-1111-4111-8111-111111111111'
on conflict (organization_id,project_id,package_id,user_id) do update set role=excluded.role,status='active';
set local role authenticated;
set local request.jwt.claim.sub='32222222-2222-4222-8222-222222222222';
do $unassigned_client_read_denied$
declare r jsonb;
begin
 r:=projectceo_read_api.get_external_review('41111111-1111-4111-8111-111111111111','41111111-1111-4111-8111-111111111111',current_setting('r109.unassigned_submission_id')::uuid);
 if r#>>'{error,code}' is distinct from 'forbidden' or r->'data' is distinct from 'null'::jsonb then raise exception 'R109_UNASSIGNED_CLIENT_READ_ALLOWED'; end if;
end $unassigned_client_read_denied$;
reset role;
rollback;
