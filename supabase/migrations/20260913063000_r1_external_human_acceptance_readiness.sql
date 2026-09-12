-- E: private human file acceptance and exact source readiness. This is neither
-- CLIENT_APPROVED nor TECHNICALLY_REVIEWED, and creates no native graph/release.
begin;

alter table remhaos_integration.file_intake_events add unique(organization_id,project_id,intake_id,event_id);
alter table remhaos_integration.external_asset_validation_lineage add unique(organization_id,project_id,package_id,asset_version_id,generation_id,intake_id,validation_receipt_id,canonical_receipt_id);
create table remhaos_integration.external_file_intake_decisions (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 intake_id uuid not null, decision_id uuid not null default extensions.gen_random_uuid(),
 generation_id uuid not null, asset_version_id uuid not null, validation_receipt_id uuid not null, canonical_receipt_id uuid not null,
 source_sha256 bytea not null check(octet_length(source_sha256)=32), byte_length bigint not null check(byte_length>0),
 validated_format text not null, validation_profile text not null,
 decision text not null check(decision in ('accepted','rejected')),
 reason text not null check(reason=btrim(reason) and char_length(reason) between 1 and 2000),
 decided_by_user_id uuid not null, decided_at timestamptz not null,
 capability text not null default 'review_source' check(capability='review_source'),
 authority_scope text not null check(authority_scope in ('project','package')),
 intake_event_id uuid not null,
 primary key(organization_id,project_id,package_id,intake_id),
 unique(organization_id,project_id,package_id,decision_id),
 foreign key(organization_id,project_id,package_id,asset_version_id,generation_id,intake_id,validation_receipt_id,canonical_receipt_id)
 references remhaos_integration.external_asset_validation_lineage(organization_id,project_id,package_id,asset_version_id,generation_id,intake_id,validation_receipt_id,canonical_receipt_id),
 foreign key(organization_id,decided_by_user_id) references project_intelligence.organization_members(organization_id,user_id),
 foreign key(organization_id,project_id,intake_id,intake_event_id) references remhaos_integration.file_intake_events(organization_id,project_id,intake_id,event_id)
);

-- Shared byte/authority locking for the human acceptance door and the final
-- readiness assertion. Returning this private context is NOT source readiness.
create function remhaos_integration._lock_external_source_review_context(
 p_organization_id uuid,p_project_id uuid,p_package_id uuid,p_asset_version_id uuid
) returns remhaos_integration.external_asset_validation_lineage
language plpgsql security definer set search_path='' as $f$
declare l remhaos_integration.external_asset_validation_lineage%rowtype;
 g remhaos_integration.external_upload_generations%rowtype; s remhaos_integration.external_upload_sessions%rowtype;
 j remhaos_integration.external_validation_jobs%rowtype; h remhaos_integration.external_upload_policy_heads%rowtype;
 b remhaos_integration.external_upload_policy_bindings%rowtype;
begin
 perform 1 from project_intelligence.project_workflows where organization_id=p_organization_id and project_id=p_project_id for share;
 if not found then perform projectceo_product._raise('P1111','validation_failed','{"reason":"external_source_not_ready"}'); end if;
 perform 1 from project_intelligence.organizations where id=p_organization_id and status='active' and cell_code='ru' for share;
 if not found then perform projectceo_product._raise('P1111','validation_failed','{"reason":"external_source_not_ready"}'); end if;
 perform 1 from projectceo_foundation.project_packages where organization_id=p_organization_id and project_id=p_project_id and id=p_package_id and status='active' for share;
 if not found then perform projectceo_product._raise('P1111','validation_failed','{"reason":"external_source_not_ready"}'); end if;
 select * into h from remhaos_integration.external_upload_policy_heads where organization_id=p_organization_id and project_id=p_project_id for share;
 if not found then perform projectceo_product._raise('P1111','validation_failed','{"reason":"external_source_not_ready"}'); end if;
 select * into b from remhaos_integration.external_upload_policy_bindings where organization_id=p_organization_id and project_id=p_project_id and policy_binding_id=h.policy_binding_id;
 if not found or not h.read_eligible or b.valid_from>clock_timestamp() or b.valid_until<=clock_timestamp() then perform projectceo_product._raise('P1111','validation_failed','{"reason":"external_source_not_ready"}'); end if;
 perform 1 from remhaos_integration.external_upload_quota_ledgers where organization_id=p_organization_id and project_id=p_project_id for share;
 select * into l from remhaos_integration.external_asset_validation_lineage where organization_id=p_organization_id and project_id=p_project_id and package_id=p_package_id and asset_version_id=p_asset_version_id;
 if not found then perform projectceo_product._raise('P1111','validation_failed','{"reason":"external_source_not_ready"}'); end if;
 select * into strict g from remhaos_integration.external_upload_generations where organization_id=p_organization_id and project_id=p_project_id and package_id=p_package_id and generation_id=l.generation_id;
 select * into strict s from remhaos_integration.external_upload_sessions where organization_id=p_organization_id and project_id=p_project_id and package_id=p_package_id and session_id=g.session_id for share;
 select * into strict j from remhaos_integration.external_validation_jobs where organization_id=p_organization_id and project_id=p_project_id and package_id=p_package_id and job_id=l.job_id for share;
 perform 1 from remhaos_integration.file_intakes where organization_id=p_organization_id and project_id=p_project_id and package_id=p_package_id and intake_id=l.intake_id for share;
 if s.state<>'finalized' or j.state<>'succeeded' or s.cancellation_revision<>j.session_cancellation_revision or h.cancellation_revision<>j.policy_cancellation_revision
  or b.valid_until<=clock_timestamp() then perform projectceo_product._raise('P1111','validation_failed','{"reason":"external_source_not_ready"}'); end if;
 -- Historical storage/scan policy is validated by immutable receipt lineage.
 -- It is not replaced by current upload-profile preferences or worker employment.
 perform remhaos_integration._assert_external_materialization(p_organization_id,p_project_id,p_package_id,l.generation_id);
 return l;
end $f$;

create function remhaos_integration._external_intake_decision_closure()
returns trigger language plpgsql security definer set search_path='' as $f$
declare i remhaos_integration.file_intakes%rowtype; d remhaos_integration.external_file_intake_decisions%rowtype;
 v remhaos_integration.external_validation_receipts%rowtype; event remhaos_integration.file_intake_events%rowtype;
begin
 select * into strict i from remhaos_integration.file_intakes where organization_id=new.organization_id and project_id=new.project_id and intake_id=new.intake_id;
 if i.r1_generation_id is null then return null; end if;
 select * into d from remhaos_integration.external_file_intake_decisions where organization_id=i.organization_id and project_id=i.project_id and package_id=i.package_id and intake_id=i.intake_id;
 if not found then
  if i.review_decision is not null or i.reviewed_by_user_id is not null or i.reviewed_at is not null or i.status<>'clean' then raise exception 'R1_HUMAN_FILE_DECISION_MISSING'; end if;
  return null;
 end if;
 select * into strict v from remhaos_integration.external_validation_receipts where organization_id=d.organization_id and project_id=d.project_id and package_id=d.package_id and receipt_id=d.validation_receipt_id;
 select * into strict event from remhaos_integration.file_intake_events where organization_id=d.organization_id and project_id=d.project_id and event_id=d.intake_event_id;
 if d.generation_id<>i.r1_generation_id or d.source_sha256 is distinct from i.checksum or d.byte_length<>i.size_bytes or d.source_sha256 is distinct from v.source_sha256 or d.byte_length is distinct from v.byte_length or d.validated_format is distinct from v.validated_format or d.validation_profile is distinct from v.validation_profile
  or i.review_decision is distinct from d.decision or i.reviewed_by_user_id is distinct from d.decided_by_user_id or i.reviewed_at is distinct from d.decided_at
  or event.intake_id<>i.intake_id or event.actor_type<>'human' or event.actor_user_id is distinct from d.decided_by_user_id or event.actor_id<>d.decided_by_user_id::text or event.created_at<>d.decided_at or event.from_status is distinct from 'clean' or event.sanitized_metadata->>'decision' is distinct from d.decision or event.sanitized_metadata->>'assetVersionId' is distinct from d.asset_version_id::text or event.sanitized_metadata->>'generationId' is distinct from d.generation_id::text
  or (d.decision='accepted' and (i.status not in ('human_reviewed','ingested_candidate','published_internal_copy') or event.to_status<>'human_reviewed' or event.event_type<>'file_human_reviewed'))
  or (d.decision='rejected' and (i.status<>'rejected' or event.to_status<>'rejected' or event.event_type<>'file_human_rejected')) then raise exception 'R1_HUMAN_FILE_DECISION_CORRELATION'; end if;
 return null;
end $f$;
create constraint trigger r1_intake_decision_fields_closure after insert or update on remhaos_integration.file_intakes deferrable initially deferred for each row execute function remhaos_integration._external_intake_decision_closure();
create constraint trigger r1_intake_decision_evidence_closure after insert on remhaos_integration.external_file_intake_decisions deferrable initially deferred for each row execute function remhaos_integration._external_intake_decision_closure();

create function remhaos_integration._review_external_file_intake(
 p_project_id uuid,p_package_id uuid,p_intake_id uuid,p_decision text,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare ctx record; replay_context record; l remhaos_integration.external_asset_validation_lineage%rowtype;
 i remhaos_integration.file_intakes%rowtype; v remhaos_integration.external_validation_receipts%rowtype;
 d remhaos_integration.external_file_intake_decisions%rowtype; event_id uuid:=extensions.gen_random_uuid(); decision_id uuid:=extensions.gen_random_uuid(); decided_at timestamptz; target_state text; result jsonb;
begin
 if p_decision is null or p_decision not in ('accepted','rejected') or p_reason is null or char_length(btrim(p_reason)) not between 1 and 2000 then perform projectceo_product._raise('P1111','validation_failed','{}'); end if;
 select * into strict ctx from projectceo_foundation._authorize_package_human(p_project_id,p_package_id,'review_source');
 perform 1 from project_intelligence.project_workflows where organization_id=ctx.organization_id and project_id=p_project_id for update;
 perform 1 from project_intelligence.organizations where id=ctx.organization_id for share;
 perform 1 from projectceo_foundation.project_packages where organization_id=ctx.organization_id and project_id=p_project_id and id=p_package_id for share;
 perform 1 from project_intelligence.organization_members where organization_id=ctx.organization_id and user_id=ctx.actor_user_id for share;
 perform 1 from projectceo_foundation.project_memberships where organization_id=ctx.organization_id and project_id=p_project_id and user_id=ctx.actor_user_id for share;
 perform 1 from projectceo_foundation.project_member_capabilities where organization_id=ctx.organization_id and project_id=p_project_id and user_id=ctx.actor_user_id and capability='review_source' for share;
 perform 1 from projectceo_foundation.package_memberships where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and user_id=ctx.actor_user_id for share;
 perform 1 from projectceo_foundation.package_member_capabilities where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and user_id=ctx.actor_user_id and capability='review_source' for share;
 select * into strict ctx from projectceo_foundation._authorize_package_human(p_project_id,p_package_id,'review_source');
 select * into l from remhaos_integration.external_asset_validation_lineage where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and intake_id=p_intake_id;
 if not found then perform projectceo_product._raise('P1104','not_found','{}'); end if;
 l:=remhaos_integration._lock_external_source_review_context(ctx.organization_id,p_project_id,p_package_id,l.asset_version_id);
 if not exists(select 1 from remhaos_integration.external_upload_policy_heads where organization_id=ctx.organization_id and project_id=p_project_id and write_eligible) then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 select * into replay_context from remhaos_integration._external_validation_replay(ctx.organization_id,p_project_id,'review_external_file_intake',ctx.actor_id,p_idempotency_key,jsonb_build_object('packageId',p_package_id,'intakeId',p_intake_id,'generationId',l.generation_id,'assetVersionId',l.asset_version_id,'decision',p_decision,'reason',btrim(p_reason)));
 if replay_context.replay is not null then
  select * into d from remhaos_integration.external_file_intake_decisions where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and intake_id=p_intake_id;
  if not found or replay_context.replay#>>'{result,decisionId}' is distinct from d.decision_id::text or d.decided_by_user_id<>ctx.actor_user_id or d.decision<>p_decision or d.reason<>btrim(p_reason) then perform projectceo_product._raise('P1108','idempotency_conflict','{}'); end if;
  return replay_context.replay;
 end if;
 select * into strict i from remhaos_integration.file_intakes where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and intake_id=p_intake_id for update;
 if i.status<>'clean' or i.scan_outcome is distinct from 'clean' or i.review_decision is not null or exists(select 1 from remhaos_integration.external_file_intake_decisions where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and intake_id=p_intake_id) then perform projectceo_product._raise('P1107','stale_state','{}'); end if;
 select * into strict v from remhaos_integration.external_validation_receipts where organization_id=l.organization_id and project_id=l.project_id and package_id=l.package_id and receipt_id=l.validation_receipt_id;
 decided_at:=clock_timestamp(); target_state:=case when p_decision='accepted' then 'human_reviewed' else 'rejected' end;
 set constraints remhaos_integration.r1_intake_decision_fields_closure,remhaos_integration.r1_intake_decision_evidence_closure deferred;
 update remhaos_integration.file_intakes set status=target_state,review_decision=p_decision,reviewed_by_user_id=ctx.actor_user_id,reviewed_at=decided_at where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and intake_id=p_intake_id;
 insert into remhaos_integration.file_intake_events(organization_id,project_id,intake_id,event_id,from_status,to_status,event_type,actor_type,actor_id,actor_user_id,sanitized_metadata,created_at)
 values(ctx.organization_id,p_project_id,p_intake_id,event_id,'clean',target_state,case when p_decision='accepted' then 'file_human_reviewed' else 'file_human_rejected' end,'human',ctx.actor_id,ctx.actor_user_id,jsonb_build_object('decision',p_decision,'assetVersionId',l.asset_version_id,'generationId',l.generation_id),decided_at);
 insert into remhaos_integration.external_file_intake_decisions(organization_id,project_id,package_id,intake_id,decision_id,generation_id,asset_version_id,validation_receipt_id,canonical_receipt_id,source_sha256,byte_length,validated_format,validation_profile,decision,reason,decided_by_user_id,decided_at,authority_scope,intake_event_id)
 values(ctx.organization_id,p_project_id,p_package_id,p_intake_id,decision_id,l.generation_id,l.asset_version_id,l.validation_receipt_id,l.canonical_receipt_id,i.checksum,i.size_bytes,v.validated_format,v.validation_profile,p_decision,btrim(p_reason),ctx.actor_user_id,decided_at,case when ctx.project_wide then 'project' else 'package' end,event_id);
 set constraints remhaos_integration.r1_intake_decision_fields_closure,remhaos_integration.r1_intake_decision_evidence_closure immediate;
 set constraints remhaos_integration.r1_intake_decision_fields_closure,remhaos_integration.r1_intake_decision_evidence_closure deferred;
 result:=jsonb_build_object('decisionId',decision_id,'intakeId',p_intake_id,'assetVersionId',l.asset_version_id,'generationId',l.generation_id,'decision',p_decision,'status',target_state,'reviewedAt',decided_at);
 return remhaos_integration._complete_command(ctx.organization_id,p_project_id,'review_external_file_intake',replay_context.key_digest,replay_context.request_digest,'human',ctx.actor_id,ctx.actor_user_id,result,'review_external_file_intake','ok',jsonb_build_object('decision',p_decision));
end $f$;

create function projectceo_foundation.assert_external_source_ready(
 p_organization_id uuid,p_project_id uuid,p_package_id uuid,p_asset_version_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $f$
declare l remhaos_integration.external_asset_validation_lineage%rowtype;
 d remhaos_integration.external_file_intake_decisions%rowtype; i remhaos_integration.file_intakes%rowtype; e remhaos_integration.file_intake_events%rowtype; v remhaos_integration.external_validation_receipts%rowtype;
begin
 l:=remhaos_integration._lock_external_source_review_context(p_organization_id,p_project_id,p_package_id,p_asset_version_id);
 select * into d from remhaos_integration.external_file_intake_decisions where organization_id=p_organization_id and project_id=p_project_id and package_id=p_package_id and intake_id=l.intake_id and asset_version_id=p_asset_version_id and decision='accepted';
 if not found then perform projectceo_product._raise('P1111','validation_failed','{"reason":"external_source_not_ready"}'); end if;
 select * into strict i from remhaos_integration.file_intakes where organization_id=p_organization_id and project_id=p_project_id and package_id=p_package_id and intake_id=l.intake_id;
 select * into strict e from remhaos_integration.file_intake_events where organization_id=p_organization_id and project_id=p_project_id and intake_id=l.intake_id and event_id=d.intake_event_id;
 select * into strict v from remhaos_integration.external_validation_receipts where organization_id=p_organization_id and project_id=p_project_id and package_id=p_package_id and receipt_id=l.validation_receipt_id;
 if i.scan_outcome is distinct from 'clean' or i.status not in ('human_reviewed','ingested_candidate','published_internal_copy') or i.review_decision is distinct from 'accepted' or i.reviewed_by_user_id is distinct from d.decided_by_user_id or i.reviewed_at is distinct from d.decided_at or d.generation_id<>l.generation_id or d.validation_receipt_id<>l.validation_receipt_id or d.canonical_receipt_id<>l.canonical_receipt_id or d.source_sha256<>i.checksum or d.byte_length<>i.size_bytes or e.event_type<>'file_human_reviewed' or e.actor_type<>'human' or e.actor_user_id is distinct from d.decided_by_user_id or e.actor_id<>d.decided_by_user_id::text or e.created_at<>d.decided_at or e.from_status is distinct from 'clean' or e.to_status<>'human_reviewed' or e.sanitized_metadata->>'decision' is distinct from 'accepted' or e.sanitized_metadata->>'assetVersionId' is distinct from d.asset_version_id::text or e.sanitized_metadata->>'generationId' is distinct from d.generation_id::text or d.validated_format is distinct from v.validated_format or d.validation_profile is distinct from v.validation_profile then perform projectceo_product._raise('P1111','validation_failed','{"reason":"external_source_not_ready"}'); end if;
 return jsonb_build_object('assetVersionId',p_asset_version_id,'generationId',l.generation_id,'receiptId',l.validation_receipt_id,'sha256',encode(d.source_sha256,'hex'),'byteLength',d.byte_length,'validatedFormat',d.validated_format,'validationProfile',d.validation_profile);
exception when others then
 -- This assertion performs no domain writes. A malformed/missing dependency
 -- always denies readiness with the frozen safe error, never a success fallback.
 perform projectceo_product._raise('P1111','validation_failed','{"reason":"external_source_not_ready"}');
end $f$;

do $registry$
declare operations text[]; definition text; literal_array text;
begin
 select pg_get_constraintdef(c.oid) into definition from pg_constraint c where c.conrelid='remhaos_integration.command_records'::regclass and c.conname='command_records_operation_check';
 literal_array:=(regexp_match(definition,$re$'(\{[^']+\})'$re$))[1];
 if literal_array is not null then operations:=literal_array::text[];
 else select array_agg(m[1]) into operations from regexp_matches(definition,$re$'([a-z0-9_]+)'$re$,'g') m; end if;
 if operations is null then raise exception 'HUMAN_INTAKE_COMMAND_REGISTRY_MISSING'; end if;
 alter table remhaos_integration.command_records drop constraint command_records_operation_check;
 execute format('alter table remhaos_integration.command_records add constraint command_records_operation_check check(operation=any(%L::text[]))',operations||array['review_external_file_intake']);
end $registry$;
create trigger external_file_intake_decisions_append_only before update or delete on remhaos_integration.external_file_intake_decisions for each row execute function projectceo_foundation.reject_append_only_mutation();
alter table remhaos_integration.external_file_intake_decisions owner to pi_table_owner;
alter table remhaos_integration.external_file_intake_decisions enable row level security;
alter table remhaos_integration.external_file_intake_decisions force row level security;
revoke all on remhaos_integration.external_file_intake_decisions from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
create policy external_file_intake_decisions_owner_only on remhaos_integration.external_file_intake_decisions for all to pi_table_owner using(true) with check(true);
do $security$
declare f regprocedure;
begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='remhaos_integration' and p.proname in ('_lock_external_source_review_context','_external_intake_decision_closure','_review_external_file_intake')) or (n.nspname='projectceo_foundation' and p.proname='assert_external_source_ready') loop
  execute format('alter function %s owner to pi_table_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',f);
 end loop;
end $security$;
commit;
