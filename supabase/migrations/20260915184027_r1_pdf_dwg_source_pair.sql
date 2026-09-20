-- Original source-pair confirmation only; no representation or runtime grant.
begin;
create table projectceo_foundation.pdf_dwg_source_pair_confirmations (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 confirmation_id uuid not null default extensions.gen_random_uuid(),
 architect_user_id uuid not null, authority_scope text not null check(authority_scope in ('project','package')),
 confirmed_at timestamptz not null default clock_timestamp(),
 reason text not null check(reason=btrim(reason) and char_length(reason) between 1 and 2000),
 schema_version text not null default 'r1-source-pair-confirmation/1' check(schema_version='r1-source-pair-confirmation/1'),
 confirmation_status text not null default 'architect_confirmed' check(confirmation_status='architect_confirmed'),
 conversion_status text not null default 'unconfirmed' check(conversion_status='unconfirmed'),
 key_digest bytea not null check(octet_length(key_digest)=32), request_digest bytea not null check(octet_length(request_digest)=32),
 dwg_asset_version_id uuid not null, dwg_intake_id uuid not null, dwg_generation_id uuid not null,
 dwg_validation_receipt_id uuid not null, dwg_canonical_receipt_id uuid not null,
 dwg_asset_id uuid not null, dwg_revision_no integer not null check(dwg_revision_no>0),
 dwg_sha256 bytea not null check(octet_length(dwg_sha256)=32), dwg_byte_length bigint not null check(dwg_byte_length>0),
 foreign key(organization_id,project_id,package_id,dwg_asset_version_id,dwg_generation_id,dwg_intake_id,dwg_validation_receipt_id,dwg_canonical_receipt_id)
 references remhaos_integration.external_asset_validation_lineage(organization_id,project_id,package_id,asset_version_id,generation_id,intake_id,validation_receipt_id,canonical_receipt_id),
 pdf_asset_version_id uuid not null, pdf_intake_id uuid not null, pdf_generation_id uuid not null,
 pdf_validation_receipt_id uuid not null, pdf_canonical_receipt_id uuid not null,
 pdf_asset_id uuid not null, pdf_revision_no integer not null check(pdf_revision_no>0),
 pdf_sha256 bytea not null check(octet_length(pdf_sha256)=32), pdf_byte_length bigint not null check(pdf_byte_length>0),
 foreign key(organization_id,project_id,package_id,pdf_asset_version_id,pdf_generation_id,pdf_intake_id,pdf_validation_receipt_id,pdf_canonical_receipt_id)
 references remhaos_integration.external_asset_validation_lineage(organization_id,project_id,package_id,asset_version_id,generation_id,intake_id,validation_receipt_id,canonical_receipt_id),
 primary key(organization_id,project_id,package_id,confirmation_id),
 unique(organization_id,project_id,key_digest),
 foreign key(organization_id,architect_user_id) references project_intelligence.organization_members(organization_id,user_id),
 check(dwg_asset_version_id<>pdf_asset_version_id)
);
create function projectceo_foundation._pdf_dwg_pair_result(r projectceo_foundation.pdf_dwg_source_pair_confirmations)
returns jsonb language sql stable set search_path='' as $f$
 select jsonb_build_object('confirmationId',r.confirmation_id,'schemaVersion',r.schema_version,
 'dwgAssetVersionId',r.dwg_asset_version_id,'pdfAssetVersionId',r.pdf_asset_version_id,
 'dwgRevision',r.dwg_revision_no,'pdfRevision',r.pdf_revision_no,
 'dwgSha256',encode(r.dwg_sha256,'hex'),'pdfSha256',encode(r.pdf_sha256,'hex'),
 'confirmedAt',to_char(r.confirmed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'confirmationStatus',r.confirmation_status,'conversionStatus',r.conversion_status,
 'warning','PDF предоставлен архитектором; DWG conversion не подтверждён');
$f$;
create function projectceo_foundation._assert_pdf_dwg_pair_closure(p_org uuid,p_project uuid,p_key bytea)
returns void language plpgsql security definer set search_path='' as $f$
declare r projectceo_foundation.pdf_dwg_source_pair_confirmations%rowtype;
 c remhaos_integration.command_records%rowtype; av projectceo_foundation.external_asset_versions%rowtype;
 v remhaos_integration.external_validation_receipts%rowtype; k text; rid uuid; aid uuid; profile text;
begin
 select * into strict r from projectceo_foundation.pdf_dwg_source_pair_confirmations where organization_id=p_org and project_id=p_project and key_digest=p_key;
 select * into strict c from remhaos_integration.command_records where organization_id=p_org and project_id=p_project and operation='confirm_pdf_dwg_source_pair' and key_digest=p_key;
 if c.actor_type<>'human' or c.actor_user_id<>r.architect_user_id or c.actor_id<>r.architect_user_id::text or c.request_digest<>r.request_digest or c.logical_result is distinct from projectceo_foundation._pdf_dwg_pair_result(r)
 or r.request_digest is distinct from project_intelligence._sha256_jsonb(jsonb_build_object('organizationId',p_org,'projectId',p_project,'operation','confirm_pdf_dwg_source_pair','actor',r.architect_user_id::text,'payload',jsonb_build_object('packageId',r.package_id,'dwgAssetVersionId',r.dwg_asset_version_id,'pdfAssetVersionId',r.pdf_asset_version_id,'reason',r.reason))) then raise exception 'R1_SOURCE_PAIR_COMMAND_MISMATCH'; end if;
 foreach k in array array['dwg','pdf'] loop
  aid:=case when k='dwg' then r.dwg_asset_version_id else r.pdf_asset_version_id end;
  rid:=case when k='dwg' then r.dwg_validation_receipt_id else r.pdf_validation_receipt_id end;
  profile:=case when k='dwg' then 'dwg-original-retention-v1' else 'legacy-pdf-intake-v1' end;
  select * into strict av from projectceo_foundation.external_asset_versions where organization_id=p_org and project_id=p_project and package_id=r.package_id and asset_version_id=aid;
  select * into strict v from remhaos_integration.external_validation_receipts where organization_id=p_org and project_id=p_project and package_id=r.package_id and receipt_id=rid;
  if av.validated_format<>k or v.validated_format<>k or v.validation_profile<>profile or v.outcome<>'successful' or v.av_outcome<>'clean' or av.server_sha256<>v.source_sha256 or av.byte_length<>v.byte_length
   or av.server_sha256<>(case when k='dwg' then r.dwg_sha256 else r.pdf_sha256 end)
   or av.byte_length<>(case when k='dwg' then r.dwg_byte_length else r.pdf_byte_length end)
   or av.asset_id<>(case when k='dwg' then r.dwg_asset_id else r.pdf_asset_id end)
   or av.revision_no<>(case when k='dwg' then r.dwg_revision_no else r.pdf_revision_no end)
   or not exists(select 1 from projectceo_foundation.external_assets a where a.organization_id=p_org and a.project_id=p_project and a.package_id=r.package_id and a.asset_id=av.asset_id and a.source_kind=k)
   or not exists(select 1 from remhaos_integration.external_file_intake_decisions d where d.organization_id=p_org and d.project_id=p_project and d.package_id=r.package_id and d.asset_version_id=aid and d.validation_receipt_id=rid and d.decision='accepted') then raise exception 'R1_SOURCE_PAIR_LINEAGE_MISMATCH'; end if;
 end loop;
 if (select count(*) from remhaos_integration.audit_events a where a.organization_id=p_org and a.project_id=p_project and a.command_id=c.command_id)<>1
 or not exists(select 1 from remhaos_integration.audit_events a where a.organization_id=p_org and a.project_id=p_project and a.command_id=c.command_id and a.actor_type='human' and a.actor_id=r.architect_user_id::text and a.action='confirm_pdf_dwg_source_pair' and a.outcome_code='ok' and a.sanitized_metadata=jsonb_build_object('confirmationId',r.confirmation_id,'confirmationStatus',r.confirmation_status)) then raise exception 'R1_SOURCE_PAIR_AUDIT_MISMATCH'; end if;
end $f$;
create function projectceo_foundation._pdf_dwg_pair_closure_trigger()
returns trigger language plpgsql security definer set search_path='' as $f$
declare c remhaos_integration.command_records%rowtype;
begin
 if tg_table_name='pdf_dwg_source_pair_confirmations' then
  perform projectceo_foundation._assert_pdf_dwg_pair_closure(new.organization_id,new.project_id,new.key_digest);
 elsif tg_table_name='command_records' then
  if new.operation='confirm_pdf_dwg_source_pair' then perform projectceo_foundation._assert_pdf_dwg_pair_closure(new.organization_id,new.project_id,new.key_digest); end if;
 else
  select * into c from remhaos_integration.command_records where organization_id=new.organization_id and project_id=new.project_id and command_id=new.command_id;
  if c.operation='confirm_pdf_dwg_source_pair' then perform projectceo_foundation._assert_pdf_dwg_pair_closure(c.organization_id,c.project_id,c.key_digest); end if;
 end if;
 return null;
end $f$;
create constraint trigger r1_source_pair_receipt_closure after insert on projectceo_foundation.pdf_dwg_source_pair_confirmations deferrable initially deferred for each row execute function projectceo_foundation._pdf_dwg_pair_closure_trigger();
create constraint trigger r1_source_pair_command_closure after insert on remhaos_integration.command_records deferrable initially deferred for each row execute function projectceo_foundation._pdf_dwg_pair_closure_trigger();
create constraint trigger r1_source_pair_audit_closure after insert on remhaos_integration.audit_events deferrable initially deferred for each row execute function projectceo_foundation._pdf_dwg_pair_closure_trigger();
create function projectceo_foundation._confirm_pdf_dwg_source_pair(p_project_id uuid,p_package_id uuid,p_dwg_asset_version_id uuid,p_pdf_asset_version_id uuid,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare ctx record; replay_context record; ready jsonb; av_id uuid;
 dl remhaos_integration.external_asset_validation_lineage%rowtype; pl remhaos_integration.external_asset_validation_lineage%rowtype;
 da projectceo_foundation.external_asset_versions%rowtype; pa projectceo_foundation.external_asset_versions%rowtype;
 r projectceo_foundation.pdf_dwg_source_pair_confirmations%rowtype; response jsonb;
begin
 if p_project_id is null or p_package_id is null or p_dwg_asset_version_id is null or p_pdf_asset_version_id is null or p_dwg_asset_version_id=p_pdf_asset_version_id or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 2000 then perform projectceo_product._raise('P1111','validation_failed','{}'); end if;
 select * into strict ctx from projectceo_foundation._authorize_pdf_fallback_architect(p_project_id,p_package_id);
 for av_id in select id from unnest(array[p_dwg_asset_version_id,p_pdf_asset_version_id]) id order by id loop
  ready:=projectceo_foundation.assert_external_source_ready(ctx.organization_id,p_project_id,p_package_id,av_id);
  if (av_id=p_dwg_asset_version_id and (ready->>'validatedFormat'<>'dwg' or ready->>'validationProfile'<>'dwg-original-retention-v1')) or (av_id=p_pdf_asset_version_id and (ready->>'validatedFormat'<>'pdf' or ready->>'validationProfile'<>'legacy-pdf-intake-v1')) then perform projectceo_product._raise('P1111','validation_failed','{}'); end if;
 end loop;
 if not exists(select 1 from remhaos_integration.external_upload_policy_heads where organization_id=ctx.organization_id and project_id=p_project_id and write_eligible) then perform projectceo_product._raise('P1103','forbidden','{}'); end if;
 select * into strict replay_context from remhaos_integration._external_validation_replay(ctx.organization_id,p_project_id,'confirm_pdf_dwg_source_pair',ctx.actor_id,p_idempotency_key,jsonb_build_object('packageId',p_package_id,'dwgAssetVersionId',p_dwg_asset_version_id,'pdfAssetVersionId',p_pdf_asset_version_id,'reason',p_reason));
 if replay_context.replay is not null then
  perform projectceo_foundation._assert_pdf_dwg_pair_closure(ctx.organization_id,p_project_id,replay_context.key_digest);
  return replay_context.replay;
 end if;
 select * into strict dl from remhaos_integration.external_asset_validation_lineage where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and asset_version_id=p_dwg_asset_version_id;
 select * into strict pl from remhaos_integration.external_asset_validation_lineage where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and asset_version_id=p_pdf_asset_version_id;
 select * into strict da from projectceo_foundation.external_asset_versions where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and asset_version_id=p_dwg_asset_version_id;
 select * into strict pa from projectceo_foundation.external_asset_versions where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and asset_version_id=p_pdf_asset_version_id;
 set constraints projectceo_foundation.r1_source_pair_receipt_closure,remhaos_integration.r1_source_pair_command_closure,remhaos_integration.r1_source_pair_audit_closure deferred;
 insert into projectceo_foundation.pdf_dwg_source_pair_confirmations(organization_id,project_id,package_id,architect_user_id,authority_scope,reason,key_digest,request_digest,dwg_asset_version_id,dwg_intake_id,dwg_generation_id,dwg_validation_receipt_id,dwg_canonical_receipt_id,dwg_asset_id,dwg_revision_no,dwg_sha256,dwg_byte_length,pdf_asset_version_id,pdf_intake_id,pdf_generation_id,pdf_validation_receipt_id,pdf_canonical_receipt_id,pdf_asset_id,pdf_revision_no,pdf_sha256,pdf_byte_length)
 values(ctx.organization_id,p_project_id,p_package_id,ctx.actor_user_id,case when ctx.project_wide then 'project' else 'package' end,p_reason,replay_context.key_digest,replay_context.request_digest,dl.asset_version_id,dl.intake_id,dl.generation_id,dl.validation_receipt_id,dl.canonical_receipt_id,da.asset_id,da.revision_no,da.server_sha256,da.byte_length,pl.asset_version_id,pl.intake_id,pl.generation_id,pl.validation_receipt_id,pl.canonical_receipt_id,pa.asset_id,pa.revision_no,pa.server_sha256,pa.byte_length) returning * into r;
 response:=remhaos_integration._complete_command(ctx.organization_id,p_project_id,'confirm_pdf_dwg_source_pair',replay_context.key_digest,replay_context.request_digest,'human',ctx.actor_id,ctx.actor_user_id,projectceo_foundation._pdf_dwg_pair_result(r),'confirm_pdf_dwg_source_pair','ok',jsonb_build_object('confirmationId',r.confirmation_id,'confirmationStatus',r.confirmation_status));
 perform projectceo_foundation._assert_pdf_dwg_pair_closure(ctx.organization_id,p_project_id,replay_context.key_digest);
 set constraints projectceo_foundation.r1_source_pair_receipt_closure,remhaos_integration.r1_source_pair_command_closure,remhaos_integration.r1_source_pair_audit_closure immediate;
 set constraints projectceo_foundation.r1_source_pair_receipt_closure,remhaos_integration.r1_source_pair_command_closure,remhaos_integration.r1_source_pair_audit_closure deferred;
 return response;
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
 execute format('alter table remhaos_integration.command_records add constraint command_records_operation_check check(operation=any(%L::text[]))',operations||array['confirm_pdf_dwg_source_pair']);
end $registry$;
create trigger pdf_dwg_source_pair_confirmations_append_only before update or delete on projectceo_foundation.pdf_dwg_source_pair_confirmations for each row execute function projectceo_foundation.reject_append_only_mutation();
alter table projectceo_foundation.pdf_dwg_source_pair_confirmations owner to pi_table_owner;
alter table projectceo_foundation.pdf_dwg_source_pair_confirmations enable row level security;
alter table projectceo_foundation.pdf_dwg_source_pair_confirmations force row level security;
revoke all on projectceo_foundation.pdf_dwg_source_pair_confirmations from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
create policy pdf_dwg_source_pair_owner on projectceo_foundation.pdf_dwg_source_pair_confirmations for all to pi_table_owner using(true) with check(true);
do $acl$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='projectceo_foundation' and p.proname in ('_pdf_dwg_pair_result','_assert_pdf_dwg_pair_closure','_pdf_dwg_pair_closure_trigger','_confirm_pdf_dwg_source_pair') loop
 execute format('alter function %s owner to pi_table_owner',f);
 execute format('revoke all on function %s from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',f);
 end loop;
end $acl$;
commit;
