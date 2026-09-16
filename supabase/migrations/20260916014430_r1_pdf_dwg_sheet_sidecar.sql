-- Declared PDF geometry bound to an existing pair/sheet; no preview generated.
begin;
create function projectceo_foundation._valid_pdf_sheet_geometry(p_page bigint,p_crop jsonb,p_rotation integer,p_units text,p_matrix jsonb)
returns boolean language plpgsql immutable set search_path='' as $f$
declare m double precision[]; l double precision; t double precision; r double precision; b double precision; det double precision; v double precision; x double precision; y double precision;
begin
 if p_page is null or p_page<0 or p_page>9007199254740991 or p_rotation is null or p_rotation not in(0,90,180,270) or p_units is null or p_units not in('mm','cm','m') or jsonb_typeof(p_crop) is distinct from 'object' or jsonb_typeof(p_matrix) is distinct from 'array' then return false; end if;
 if (select count(*) from jsonb_object_keys(p_crop))<>4 or not p_crop ?& array['left','top','right','bottom'] or jsonb_array_length(p_matrix)<>6 then return false; end if;
 if exists(select 1 from jsonb_each(p_crop) e where jsonb_typeof(e.value)<>'number') or exists(select 1 from jsonb_array_elements(p_matrix) e where jsonb_typeof(e)<>'number') then return false; end if;
 -- Validate exact stored JSON numerics before float8 rounds any boundary.
 if (p_crop->>'left')::numeric<0 or (p_crop->>'top')::numeric<0
 or (p_crop->>'right')::numeric>1 or (p_crop->>'bottom')::numeric>1
 or (p_crop->>'left')::numeric>=(p_crop->>'right')::numeric
 or (p_crop->>'top')::numeric>=(p_crop->>'bottom')::numeric then return false;end if;
 l:=(p_crop->>'left')::double precision; t:=(p_crop->>'top')::double precision; r:=(p_crop->>'right')::double precision; b:=(p_crop->>'bottom')::double precision;
 if l<0 or t<0 or r>1 or b>1 or l>=r or t>=b then return false; end if;
 select array_agg((e.value#>>'{}')::double precision order by e.n) into m from jsonb_array_elements(p_matrix) with ordinality e(value,n);
 det:=m[1]*m[4]-m[2]*m[3];
 if det=0 or det::text in('NaN','Infinity','-Infinity') then return false; end if;
 foreach v in array m||array[m[4]/det,-m[2]/det,-m[3]/det,m[1]/det,-((m[4]/det)*m[5]+(-m[3]/det)*m[6]),-((-m[2]/det)*m[5]+(m[1]/det)*m[6])] loop
  if v::text in('NaN','Infinity','-Infinity') then return false; end if;
 end loop;
 foreach x in array array[l,r] loop foreach y in array array[t,b] loop
  foreach v in array array[m[1]*x+m[3]*y+m[5],m[2]*x+m[4]*y+m[6]] loop if v::text in('NaN','Infinity','-Infinity') then return false; end if; end loop;
 end loop; end loop;
 return true;
exception when numeric_value_out_of_range or invalid_text_representation or division_by_zero then return false;
end $f$;
create table projectceo_foundation.pdf_dwg_sheet_sidecars (
 organization_id uuid not null,project_id uuid not null,package_id uuid not null,sidecar_id uuid not null default extensions.gen_random_uuid(),confirmation_id uuid not null,
 sheet_id text not null check(sheet_id=btrim(sheet_id) and char_length(sheet_id) between 1 and 160),sheet_revision_id text not null check(sheet_revision_id=btrim(sheet_revision_id) and char_length(sheet_revision_id) between 1 and 160),
 pdf_asset_version_id uuid not null,dwg_asset_version_id uuid not null,pdf_sha256 bytea not null check(octet_length(pdf_sha256)=32),dwg_sha256 bytea not null check(octet_length(dwg_sha256)=32),
 pdf_page_index bigint not null,pdf_crop jsonb not null,rotation_degrees integer not null,units text not null,page_to_preview_transform jsonb not null,
 schema_version text not null default 'r1-pdf-sheet-sidecar/1' check(schema_version='r1-pdf-sheet-sidecar/1'),
 geometry_evidence text not null default 'architect_declared' check(geometry_evidence='architect_declared'),page_metadata_verification text not null default 'not_verified' check(page_metadata_verification='not_verified'),
 created_by_user_id uuid not null,created_at timestamptz not null default clock_timestamp(),authority_scope text not null check(authority_scope in('project','package')),
 reason text not null check(reason=btrim(reason) and char_length(reason) between 1 and 2000),key_digest bytea not null check(octet_length(key_digest)=32),request_digest bytea not null check(octet_length(request_digest)=32),
 primary key(organization_id,project_id,package_id,sidecar_id),unique(organization_id,project_id,key_digest),
 foreign key(organization_id,project_id,package_id,confirmation_id) references projectceo_foundation.pdf_dwg_source_pair_confirmations(organization_id,project_id,package_id,confirmation_id),
 foreign key(organization_id,project_id,sheet_id,sheet_revision_id) references projectceo_m3.documentation_sheet_revisions(organization_id,project_id,sheet_id,revision_id),
 foreign key(organization_id,created_by_user_id) references project_intelligence.organization_members(organization_id,user_id),
 check(projectceo_foundation._valid_pdf_sheet_geometry(pdf_page_index,pdf_crop,rotation_degrees,units,page_to_preview_transform))
);
create function projectceo_foundation._pdf_sheet_sidecar_payload(r projectceo_foundation.pdf_dwg_sheet_sidecars) returns jsonb language sql immutable set search_path='' as $f$
 select jsonb_build_object('packageId',r.package_id,'confirmationId',r.confirmation_id,'sheetId',r.sheet_id,'sheetRevisionId',r.sheet_revision_id,'pdfPageIndex',r.pdf_page_index,'pdfCrop',r.pdf_crop,'rotationDegrees',r.rotation_degrees,'units',r.units,'pageToPreviewTransform',r.page_to_preview_transform,'reason',r.reason);
$f$;
create function projectceo_foundation._pdf_sheet_sidecar_result(r projectceo_foundation.pdf_dwg_sheet_sidecars) returns jsonb language sql stable set search_path='' as $f$
 select (projectceo_foundation._pdf_sheet_sidecar_payload(r)-'reason'-'packageId')||jsonb_build_object('sidecarId',r.sidecar_id,'schemaVersion',r.schema_version,'pdfAssetVersionId',r.pdf_asset_version_id,'pdfSha256',encode(r.pdf_sha256,'hex'),'geometryEvidence',r.geometry_evidence,'pageMetadataVerification',r.page_metadata_verification,'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'conversionStatus','unconfirmed','warning','PDF предоставлен архитектором; DWG conversion не подтверждён');
$f$;
create function projectceo_foundation._assert_pdf_sheet_sidecar(p_org uuid,p_project uuid,p_key bytea) returns void language plpgsql security definer set search_path='' as $f$
declare r projectceo_foundation.pdf_dwg_sheet_sidecars%rowtype; c remhaos_integration.command_records%rowtype; pair projectceo_foundation.pdf_dwg_source_pair_confirmations%rowtype;
begin
 select * into strict r from projectceo_foundation.pdf_dwg_sheet_sidecars where organization_id=p_org and project_id=p_project and key_digest=p_key;
 select * into strict pair from projectceo_foundation.pdf_dwg_source_pair_confirmations where organization_id=p_org and project_id=p_project and package_id=r.package_id and confirmation_id=r.confirmation_id;
 if r.pdf_asset_version_id<>pair.pdf_asset_version_id or r.dwg_asset_version_id<>pair.dwg_asset_version_id or r.pdf_sha256<>pair.pdf_sha256 or r.dwg_sha256<>pair.dwg_sha256 or not exists(select 1 from projectceo_m3.documentation_sheet_revisions d where d.organization_id=p_org and d.project_id=p_project and d.package_id=r.package_id and d.sheet_id=r.sheet_id and d.revision_id=r.sheet_revision_id) then raise exception 'R1_SIDECAR_SCOPE_OR_SOURCE_MISMATCH'; end if;
 select * into strict c from remhaos_integration.command_records where organization_id=p_org and project_id=p_project and operation='bind_pdf_dwg_sheet_sidecar' and key_digest=p_key;
 if c.actor_type<>'human' or c.actor_id<>r.created_by_user_id::text or c.actor_user_id<>r.created_by_user_id or c.request_digest<>r.request_digest or c.logical_result is distinct from projectceo_foundation._pdf_sheet_sidecar_result(r)
 or r.request_digest is distinct from project_intelligence._sha256_jsonb(jsonb_build_object('organizationId',p_org,'projectId',p_project,'operation','bind_pdf_dwg_sheet_sidecar','actor',r.created_by_user_id::text,'payload',projectceo_foundation._pdf_sheet_sidecar_payload(r))) then raise exception 'R1_SIDECAR_COMMAND_MISMATCH'; end if;
 if (select count(*) from remhaos_integration.audit_events a where a.organization_id=p_org and a.project_id=p_project and a.command_id=c.command_id)<>1 or not exists(select 1 from remhaos_integration.audit_events a where a.organization_id=p_org and a.project_id=p_project and a.command_id=c.command_id and a.actor_type='human' and a.actor_id=r.created_by_user_id::text and a.action='bind_pdf_dwg_sheet_sidecar' and a.outcome_code='ok' and a.sanitized_metadata=jsonb_build_object('sidecarId',r.sidecar_id)) then raise exception 'R1_SIDECAR_AUDIT_MISMATCH'; end if;
end $f$;
create function projectceo_foundation._pdf_sheet_sidecar_closure() returns trigger language plpgsql security definer set search_path='' as $f$
declare c remhaos_integration.command_records%rowtype;
begin
 if tg_table_name='pdf_dwg_sheet_sidecars' then perform projectceo_foundation._assert_pdf_sheet_sidecar(new.organization_id,new.project_id,new.key_digest);
 elsif tg_table_name='command_records' then if new.operation='bind_pdf_dwg_sheet_sidecar' then perform projectceo_foundation._assert_pdf_sheet_sidecar(new.organization_id,new.project_id,new.key_digest); end if;
 else select * into c from remhaos_integration.command_records where organization_id=new.organization_id and project_id=new.project_id and command_id=new.command_id; if c.operation='bind_pdf_dwg_sheet_sidecar' then perform projectceo_foundation._assert_pdf_sheet_sidecar(c.organization_id,c.project_id,c.key_digest); end if;
 end if; return null;
end $f$;
create constraint trigger r1_sheet_sidecar_receipt_closure after insert on projectceo_foundation.pdf_dwg_sheet_sidecars deferrable initially deferred for each row execute function projectceo_foundation._pdf_sheet_sidecar_closure();
create constraint trigger r1_sheet_sidecar_command_closure after insert on remhaos_integration.command_records deferrable initially deferred for each row execute function projectceo_foundation._pdf_sheet_sidecar_closure();
create constraint trigger r1_sheet_sidecar_audit_closure after insert on remhaos_integration.audit_events deferrable initially deferred for each row execute function projectceo_foundation._pdf_sheet_sidecar_closure();
create function projectceo_foundation._bind_pdf_dwg_sheet_sidecar(p_project_id uuid,p_package_id uuid,p_confirmation_id uuid,p_sheet_id text,p_sheet_revision_id text,p_pdf_page_index bigint,p_pdf_crop jsonb,p_rotation_degrees integer,p_units text,p_page_to_preview_transform jsonb,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare ctx record; replay_ctx record; pair projectceo_foundation.pdf_dwg_source_pair_confirmations%rowtype; r projectceo_foundation.pdf_dwg_sheet_sidecars%rowtype; av uuid; response jsonb;
begin
 if p_confirmation_id is null or p_sheet_id is null or p_sheet_id<>btrim(p_sheet_id) or char_length(p_sheet_id) not between 1 and 160 or p_sheet_revision_id is null or p_sheet_revision_id<>btrim(p_sheet_revision_id) or char_length(p_sheet_revision_id) not between 1 and 160 or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 2000 or not projectceo_foundation._valid_pdf_sheet_geometry(p_pdf_page_index,p_pdf_crop,p_rotation_degrees,p_units,p_page_to_preview_transform) then perform projectceo_foundation._raise('P1111','validation_failed','{}'); end if;
 select * into strict ctx from projectceo_foundation._authorize_pdf_fallback_architect(p_project_id,p_package_id);
 select * into pair from projectceo_foundation.pdf_dwg_source_pair_confirmations where organization_id=ctx.organization_id and project_id=p_project_id and package_id=p_package_id and confirmation_id=p_confirmation_id;
 if not found or not exists(select 1 from projectceo_m3.documentation_sheet_revisions d where d.organization_id=ctx.organization_id and d.project_id=p_project_id and d.package_id=p_package_id and d.sheet_id=p_sheet_id and d.revision_id=p_sheet_revision_id) then perform projectceo_foundation._raise('P1104','not_found','{}'); end if;
 for av in select id from unnest(array[pair.dwg_asset_version_id,pair.pdf_asset_version_id]) id order by id loop perform projectceo_foundation.assert_external_source_ready(ctx.organization_id,p_project_id,p_package_id,av); end loop;
 if not exists(select 1 from remhaos_integration.external_upload_policy_heads where organization_id=ctx.organization_id and project_id=p_project_id and write_eligible) then perform projectceo_foundation._raise('P1103','forbidden','{}'); end if;
 r.organization_id:=ctx.organization_id;r.project_id:=p_project_id;r.package_id:=p_package_id;r.confirmation_id:=p_confirmation_id;r.sheet_id:=p_sheet_id;r.sheet_revision_id:=p_sheet_revision_id;r.pdf_page_index:=p_pdf_page_index;r.pdf_crop:=p_pdf_crop;r.rotation_degrees:=p_rotation_degrees;r.units:=p_units;r.page_to_preview_transform:=p_page_to_preview_transform;r.reason:=p_reason;
 select * into strict replay_ctx from remhaos_integration._external_validation_replay(ctx.organization_id,p_project_id,'bind_pdf_dwg_sheet_sidecar',ctx.actor_id,p_idempotency_key,projectceo_foundation._pdf_sheet_sidecar_payload(r));
 if replay_ctx.replay is not null then perform projectceo_foundation._assert_pdf_sheet_sidecar(ctx.organization_id,p_project_id,replay_ctx.key_digest);return replay_ctx.replay;end if;
 set constraints projectceo_foundation.r1_sheet_sidecar_receipt_closure,remhaos_integration.r1_sheet_sidecar_command_closure,remhaos_integration.r1_sheet_sidecar_audit_closure deferred;
 insert into projectceo_foundation.pdf_dwg_sheet_sidecars(organization_id,project_id,package_id,confirmation_id,sheet_id,sheet_revision_id,pdf_asset_version_id,dwg_asset_version_id,pdf_sha256,dwg_sha256,pdf_page_index,pdf_crop,rotation_degrees,units,page_to_preview_transform,created_by_user_id,authority_scope,reason,key_digest,request_digest)
 values(ctx.organization_id,p_project_id,p_package_id,p_confirmation_id,p_sheet_id,p_sheet_revision_id,pair.pdf_asset_version_id,pair.dwg_asset_version_id,pair.pdf_sha256,pair.dwg_sha256,p_pdf_page_index,p_pdf_crop,p_rotation_degrees,p_units,p_page_to_preview_transform,ctx.actor_user_id,case when ctx.project_wide then 'project' else 'package' end,p_reason,replay_ctx.key_digest,replay_ctx.request_digest) returning * into r;
 response:=remhaos_integration._complete_command(ctx.organization_id,p_project_id,'bind_pdf_dwg_sheet_sidecar',replay_ctx.key_digest,replay_ctx.request_digest,'human',ctx.actor_id,ctx.actor_user_id,projectceo_foundation._pdf_sheet_sidecar_result(r),'bind_pdf_dwg_sheet_sidecar','ok',jsonb_build_object('sidecarId',r.sidecar_id));
 set constraints projectceo_foundation.r1_sheet_sidecar_receipt_closure,remhaos_integration.r1_sheet_sidecar_command_closure,remhaos_integration.r1_sheet_sidecar_audit_closure immediate;
 set constraints projectceo_foundation.r1_sheet_sidecar_receipt_closure,remhaos_integration.r1_sheet_sidecar_command_closure,remhaos_integration.r1_sheet_sidecar_audit_closure deferred;
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
 execute format('alter table remhaos_integration.command_records add constraint command_records_operation_check check(operation=any(%L::text[]))',operations||array['bind_pdf_dwg_sheet_sidecar']);
end $registry$;
create trigger pdf_dwg_sheet_sidecars_append_only before update or delete on projectceo_foundation.pdf_dwg_sheet_sidecars for each row execute function projectceo_foundation.reject_append_only_mutation();
alter table projectceo_foundation.pdf_dwg_sheet_sidecars owner to pi_table_owner;
alter table projectceo_foundation.pdf_dwg_sheet_sidecars enable row level security;
alter table projectceo_foundation.pdf_dwg_sheet_sidecars force row level security;
revoke all on projectceo_foundation.pdf_dwg_sheet_sidecars from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
create policy pdf_sheet_sidecar_owner on projectceo_foundation.pdf_dwg_sheet_sidecars for all to pi_table_owner using(true) with check(true);
do $acl$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='projectceo_foundation' and p.proname in('_valid_pdf_sheet_geometry','_pdf_sheet_sidecar_payload','_pdf_sheet_sidecar_result','_assert_pdf_sheet_sidecar','_pdf_sheet_sidecar_closure','_bind_pdf_dwg_sheet_sidecar') loop execute format('alter function %s owner to pi_table_owner',f);execute format('revoke all on function %s from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',f);end loop;
end $acl$;
commit;
