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

do $fixture$
declare
 p uuid:='41111111-1111-4111-8111-111111111111'; a uuid:='31111111-1111-4111-8111-111111111111';
 o uuid; t uuid:=extensions.gen_random_uuid(); s uuid:=extensions.gen_random_uuid(); c record; c2 record; snap jsonb; dig bytea; r jsonb; before_state bigint; decision_json jsonb; dt timestamptz:=statement_timestamp(); bad_disclosure jsonb; bad_json jsonb; typ text; null_accepted integer:=0;
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
end $fixture$;
rollback;
