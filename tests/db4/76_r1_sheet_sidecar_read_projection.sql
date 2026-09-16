\set ON_ERROR_STOP on
\if :{?r1_sheet_sidecar_read_restart_check}
begin;
select set_config('r1_read.project',project_id::text,true),set_config('r1_read.confirmation',sidecar_id::text,true),set_config('r1_read.expected',expected_result::text,true),set_config('request.jwt.claim.sub',actor_id::text,true) from r1_validation_fixture.sheet_sidecar_read_context;
create temporary table pair_restart_counts as select
 (select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) confirmations,
 (select count(*) from remhaos_integration.command_records) commands,
 (select count(*) from remhaos_integration.audit_events) audits,
 (select jsonb_agg(to_jsonb(p) order by organization_id,project_id) from project_intelligence.project_workflows p) workflows;
set local role authenticated;
do $restart$ begin
 if projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,current_setting('r1_read.confirmation')::uuid) is distinct from current_setting('r1_read.expected')::jsonb then raise exception 'PAIR_READ_RESTART_CHANGED'; end if;
end $restart$;
reset role;
do $restart_counts$ begin
 if exists(select 1 from pair_restart_counts b where b.confirmations<>(select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) or b.commands<>(select count(*) from remhaos_integration.command_records) or b.audits<>(select count(*) from remhaos_integration.audit_events) or b.workflows is distinct from (select jsonb_agg(to_jsonb(p) order by organization_id,project_id) from project_intelligence.project_workflows p)) then raise exception 'PAIR_READ_RESTART_WROTE_STATE'; end if;
end $restart_counts$;
rollback;
select 'R1_SHEET_SIDECAR_READ_RESTART_OK' as result;
\else
-- Run after persisted synthetic fixture74. No actual cloud/module activation.
begin;
select set_config('r1_read.project',project_id::text,true),set_config('r1_read.confirmation',expected_result->>'sidecarId',true),set_config('r1_read.actor',actor_id::text,true),set_config('request.jwt.claim.sub',actor_id::text,true) from r1_validation_fixture.sheet_sidecar_context;
create temporary table pair_read_snapshot as select to_jsonb(r) receipt from projectceo_foundation.pdf_dwg_sheet_sidecars r;
create temporary table pair_read_counts as select
 (select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) confirmations,
 (select count(*) from remhaos_integration.command_records) commands,
 (select count(*) from remhaos_integration.audit_events) audits,
 (select jsonb_agg(to_jsonb(p) order by organization_id,project_id) from project_intelligence.project_workflows p) workflows;
select projectceo_platform.close_module_production('m3','synthetic read fixture','closed read denial');
set local role authenticated;
do $closed$ begin
 begin perform projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,current_setting('r1_read.confirmation')::uuid); raise exception 'PAIR_READ_CLOSED_ALLOWED'; exception when insufficient_privilege then null; end;
end $closed$;
reset role;
-- Isolated accidental reader grant must not bypass the canonical M3 read gate.
grant execute on function projectceo_read_api.get_pdf_dwg_sheet_sidecar(uuid,uuid,uuid) to authenticated;
set local role authenticated;
do $partial$ begin
 begin perform projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,current_setting('r1_read.confirmation')::uuid); raise exception 'PAIR_READ_PARTIAL_GRANT_ALLOWED'; exception when sqlstate 'P1113' then null; end;
end $partial$;
reset role;
select projectceo_platform.open_module_production('m3','synthetic read fixture','exact read grant');
set local role authenticated;
do $read$ declare r jsonb; begin
 r:=projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,current_setting('r1_read.confirmation')::uuid);
 if r->>'contractVersion'<>'r1-sheet-sidecar-read/1' or r#>>'{result,conversionStatus}'<>'unconfirmed' or r#>>'{result,geometryEvidence}'<>'architect_declared' then raise exception 'PAIR_READ_STATUS'; end if;
 perform set_config('r1_read.expected',r::text,true);
 begin perform projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,'42222222-2222-4222-8222-222222222222',current_setting('r1_read.confirmation')::uuid); raise exception 'PAIR_READ_CROSS_SCOPE'; exception when sqlstate 'P1103' then null; end;
 begin perform projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,'73000000-0000-4000-8000-000000000099'); raise exception 'PAIR_READ_UNKNOWN'; exception when sqlstate 'P1104' then null; end;
 begin perform 1 from projectceo_foundation.pdf_dwg_sheet_sidecars; raise exception 'PAIR_READ_PRIVATE_TABLE_EXPOSED'; exception when insufficient_privilege then null; end;
 begin perform projectceo_foundation._pdf_sheet_sidecar_result(null::projectceo_foundation.pdf_dwg_sheet_sidecars); raise exception 'PAIR_READ_PRIVATE_HELPER_EXPOSED'; exception when insufficient_privilege then null; end;
end $read$;
reset role;
-- Current owner may read; historical source policy changes do not erase proof.
update projectceo_foundation.project_memberships set role='owner_lead' where project_id=current_setting('r1_read.project')::uuid and user_id=auth.uid();
update remhaos_integration.external_upload_policy_heads set write_eligible=false,read_eligible=false,cancellation_revision=cancellation_revision+1,revision=revision+1 where project_id=current_setting('r1_read.project')::uuid;
set local role authenticated;
do $history$ begin
 if projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,current_setting('r1_read.confirmation')::uuid) is distinct from current_setting('r1_read.expected')::jsonb then raise exception 'PAIR_READ_REQUIRES_CURRENT_SOURCE_READY'; end if;
end $history$;
reset role;
update projectceo_foundation.project_memberships set role='builder' where project_id=current_setting('r1_read.project')::uuid and user_id=auth.uid();
set local role authenticated;
do $builder$ begin
 begin perform projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,'73000000-0000-4000-8000-000000000099'); raise exception 'PAIR_READ_BUILDER_LOOKUP'; exception when sqlstate 'P1103' then null; end;
end $builder$;
reset role;
update projectceo_foundation.project_memberships set role='client_approver' where project_id=current_setting('r1_read.project')::uuid and user_id=auth.uid();
set local role authenticated;
do $client$ begin
 begin perform projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,current_setting('r1_read.confirmation')::uuid); raise exception 'PAIR_READ_CLIENT_ALLOWED'; exception when sqlstate 'P1103' then null; end;
end $client$;
reset role;
update projectceo_foundation.project_memberships set role='builder' where project_id=current_setting('r1_read.project')::uuid and user_id=auth.uid();
insert into projectceo_foundation.package_memberships(organization_id,project_id,package_id,user_id,role)
select organization_id,project_id,project_id,actor_id,'architect' from r1_validation_fixture.sheet_sidecar_context;
set local role authenticated;
do $mixed$ begin
 if projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,current_setting('r1_read.confirmation')::uuid) is distinct from current_setting('r1_read.expected')::jsonb then raise exception 'PAIR_READ_EXACT_PACKAGE_ARCHITECT'; end if;
end $mixed$;
reset role;
delete from projectceo_foundation.project_member_capabilities where project_id=current_setting('r1_read.project')::uuid and user_id=auth.uid() and capability='view_project';
insert into projectceo_foundation.package_member_capabilities(organization_id,project_id,package_id,user_id,capability)
select organization_id,project_id,project_id,actor_id,'view_project' from r1_validation_fixture.sheet_sidecar_context;
set local role authenticated;
do $package_only$ begin
 if projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,current_setting('r1_read.confirmation')::uuid) is distinct from current_setting('r1_read.expected')::jsonb then raise exception 'PAIR_READ_PACKAGE_ONLY_VIEW'; end if;
 perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true);
 begin perform projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,current_setting('r1_read.confirmation')::uuid); raise exception 'PAIR_READ_ANONYMOUS'; exception when sqlstate 'P1101' then null; end;
end $package_only$;
reset role;
do $shape$ declare expected jsonb; begin
 -- Independent explicit allowlist: no production projection helper used here.
 select jsonb_build_object('contractVersion','r1-sheet-sidecar-read/1','result',jsonb_build_object(
 'sidecarId',r.sidecar_id,'schemaVersion',r.schema_version,'confirmationId',r.confirmation_id,
 'sheetId',r.sheet_id,'sheetRevisionId',r.sheet_revision_id,'pdfAssetVersionId',r.pdf_asset_version_id,'pdfSha256',encode(r.pdf_sha256,'hex'),
 'pdfPageIndex',r.pdf_page_index,'pdfCrop',r.pdf_crop,'rotationDegrees',r.rotation_degrees,'units',r.units,'pageToPreviewTransform',r.page_to_preview_transform,
 'geometryEvidence','architect_declared','pageMetadataVerification','not_verified',
 'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'conversionStatus','unconfirmed','warning','PDF предоставлен архитектором; DWG conversion не подтверждён'))
 into strict expected from projectceo_foundation.pdf_dwg_sheet_sidecars r where r.sidecar_id=current_setting('r1_read.confirmation')::uuid;
 -- JSONB exact equality proves key set, JSON scalar types and values together.
 if expected is distinct from current_setting('r1_read.expected')::jsonb
 or exists((select receipt from pair_read_snapshot) except (select to_jsonb(r) from projectceo_foundation.pdf_dwg_sheet_sidecars r))
 or exists((select to_jsonb(r) from projectceo_foundation.pdf_dwg_sheet_sidecars r) except (select receipt from pair_read_snapshot)) then raise exception 'PAIR_READ_HISTORY_OR_PROJECTION_CHANGED'; end if;
 if exists(select 1 from pair_read_counts b where b.confirmations<>(select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) or b.commands<>(select count(*) from remhaos_integration.command_records) or b.audits<>(select count(*) from remhaos_integration.audit_events) or b.workflows is distinct from (select jsonb_agg(to_jsonb(p) order by organization_id,project_id) from project_intelligence.project_workflows p)) then raise exception 'PAIR_READ_WROTE_STATE'; end if;
end $shape$;
select projectceo_platform.close_module_production('m3','synthetic read fixture','final close');
set local role authenticated;
do $reclose$ begin
 begin perform projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('r1_read.project')::uuid,current_setting('r1_read.project')::uuid,current_setting('r1_read.confirmation')::uuid); raise exception 'PAIR_READ_AFTER_CLOSE'; exception when insufficient_privilege then null; end;
end $reclose$;
reset role;
rollback;
select 'R1_SHEET_SIDECAR_READ_PROJECTION_OK' as result;

\if :{?r1_sheet_sidecar_read_keep_fixture}
-- Main negatives rolled back. Persist only a clean read context and disposable
-- M3 opening for actual restart/concurrency harnesses. No source policy edits.
begin;
select projectceo_platform.open_module_production('m3','synthetic read context','restart and overlap proof');
select set_config('request.jwt.claim.sub',actor_id::text,true) from r1_validation_fixture.sheet_sidecar_context;
create table r1_validation_fixture.sheet_sidecar_read_context as
select organization_id,project_id,actor_id,(expected_result->>'sidecarId')::uuid sidecar_id,
 projectceo_read_api.get_pdf_dwg_sheet_sidecar(project_id,project_id,(expected_result->>'sidecarId')::uuid) expected_result
from r1_validation_fixture.sheet_sidecar_context;
commit;
\endif
\endif

\if :{?r1_sheet_sidecar_read_overlap}
-- Real two-session overlaps; only existing synthetic fixture capability rows.
create temporary table pair_overlap_counts as select
 (select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) confirmations,
 (select count(*) from remhaos_integration.command_records) commands,
 (select count(*) from remhaos_integration.audit_events) audits;
do $overlap_precondition$ begin
 if (select count(*) from r1_validation_fixture.sheet_sidecar_read_context)<>1 or not exists(select 1 from projectceo_foundation.project_member_capabilities pc join r1_validation_fixture.sheet_sidecar_read_context c using(organization_id,project_id) where pc.user_id=c.actor_id and pc.capability='view_project')
 or exists(select 1 from projectceo_foundation.package_member_capabilities pc join r1_validation_fixture.sheet_sidecar_read_context c using(organization_id,project_id) where pc.user_id=c.actor_id and pc.package_id=c.project_id and pc.capability='view_project') then raise exception 'PAIR_READ_OVERLAP_REQUIRES_SINGLE_PROJECT_CAPABILITY'; end if;
end $overlap_precondition$;
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-pair-read-revoke-first-1'"'"'"'"'"'"'"'"'; begin; delete from projectceo_foundation.project_member_capabilities pc using r1_validation_fixture.sheet_sidecar_read_context c where pc.organization_id=c.organization_id and pc.project_id=c.project_id and pc.user_id=c.actor_id and pc.capability='"'"'"'"'"'"'"'"'view_project'"'"'"'"'"'"'"'"'; select pg_sleep(3); commit;'"'"' > /tmp/r1-pair-read-revoke-first-1.log 2>&1 & first=$!; held=f; for i in $(seq 1 40); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-pair-read-revoke-first-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.025; done; printf '"'"'%s\n'"'"' "$held" > /tmp/r1-pair-read-revoke-first-held; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-pair-read-revoke-first-2'"'"'"'"'"'"'"'"'; begin; select set_config('"'"'"'"'"'"'"'"'request.jwt.claim.sub'"'"'"'"'"'"'"'"',actor_id::text,true),set_config('"'"'"'"'"'"'"'"'r1_overlap.project'"'"'"'"'"'"'"'"',project_id::text,true),set_config('"'"'"'"'"'"'"'"'r1_overlap.id'"'"'"'"'"'"'"'"',sidecar_id::text,true),set_config('"'"'"'"'"'"'"'"'r1_overlap.expected'"'"'"'"'"'"'"'"',expected_result::text,true) from r1_validation_fixture.sheet_sidecar_read_context; set local role authenticated; do $assert$ begin if projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('"'"'"'"'"'"'"'"'r1_overlap.project'"'"'"'"'"'"'"'"')::uuid,current_setting('"'"'"'"'"'"'"'"'r1_overlap.project'"'"'"'"'"'"'"'"')::uuid,current_setting('"'"'"'"'"'"'"'"'r1_overlap.id'"'"'"'"'"'"'"'"')::uuid) is distinct from current_setting('"'"'"'"'"'"'"'"'r1_overlap.expected'"'"'"'"'"'"'"'"')::jsonb then raise exception '"'"'"'"'"'"'"'"'PAIR_READ_OVERLAP_RESULT_CHANGED'"'"'"'"'"'"'"'"'; end if; end $assert$; commit;'"'"' > /tmp/r1-pair-read-revoke-first-2.log 2>&1 & second=$!; overlap=f; for i in $(seq 1 40); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-pair-read-revoke-first-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-pair-read-revoke-first-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"' and a.pid=any(pg_blocking_pids(b.pid)))'"'"'); [ "$overlap" = t ] && break; sleep 0.025; done; printf '"'"'%s\n'"'"' "$overlap" > /tmp/r1-pair-read-revoke-first-overlap; wait "$first"; a=$?; wait "$second"; b=$?; printf '"'"'%s %s\n'"'"' "$a" "$b" > /tmp/r1-pair-read-revoke-first-exits'
do $race$ begin if btrim(pg_read_file('/tmp/r1-pair-read-revoke-first-held'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-pair-read-revoke-first-overlap'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-pair-read-revoke-first-exits'),E' \n\r\t') not in ('0 1','0 3') or position('forbidden' in pg_read_file('/tmp/r1-pair-read-revoke-first-2.log'))=0 then raise exception 'PAIR_READ_OVERLAP_FAILED_revoke-first'; end if; end $race$;
insert into projectceo_foundation.project_member_capabilities(organization_id,project_id,user_id,capability) select organization_id,project_id,actor_id,'view_project' from r1_validation_fixture.sheet_sidecar_read_context;
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-pair-read-read-first-1'"'"'"'"'"'"'"'"'; begin; select set_config('"'"'"'"'"'"'"'"'request.jwt.claim.sub'"'"'"'"'"'"'"'"',actor_id::text,true),set_config('"'"'"'"'"'"'"'"'r1_overlap.project'"'"'"'"'"'"'"'"',project_id::text,true),set_config('"'"'"'"'"'"'"'"'r1_overlap.id'"'"'"'"'"'"'"'"',sidecar_id::text,true),set_config('"'"'"'"'"'"'"'"'r1_overlap.expected'"'"'"'"'"'"'"'"',expected_result::text,true) from r1_validation_fixture.sheet_sidecar_read_context; set local role authenticated; do $assert$ begin if projectceo_read_api.get_pdf_dwg_sheet_sidecar(current_setting('"'"'"'"'"'"'"'"'r1_overlap.project'"'"'"'"'"'"'"'"')::uuid,current_setting('"'"'"'"'"'"'"'"'r1_overlap.project'"'"'"'"'"'"'"'"')::uuid,current_setting('"'"'"'"'"'"'"'"'r1_overlap.id'"'"'"'"'"'"'"'"')::uuid) is distinct from current_setting('"'"'"'"'"'"'"'"'r1_overlap.expected'"'"'"'"'"'"'"'"')::jsonb then raise exception '"'"'"'"'"'"'"'"'PAIR_READ_OVERLAP_RESULT_CHANGED'"'"'"'"'"'"'"'"'; end if; end $assert$; select pg_sleep(3); commit;'"'"' > /tmp/r1-pair-read-read-first-1.log 2>&1 & first=$!; held=f; for i in $(seq 1 40); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-pair-read-read-first-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.025; done; printf '"'"'%s\n'"'"' "$held" > /tmp/r1-pair-read-read-first-held; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-pair-read-read-first-2'"'"'"'"'"'"'"'"'; begin; delete from projectceo_foundation.project_member_capabilities pc using r1_validation_fixture.sheet_sidecar_read_context c where pc.organization_id=c.organization_id and pc.project_id=c.project_id and pc.user_id=c.actor_id and pc.capability='"'"'"'"'"'"'"'"'view_project'"'"'"'"'"'"'"'"'; commit;'"'"' > /tmp/r1-pair-read-read-first-2.log 2>&1 & second=$!; overlap=f; for i in $(seq 1 40); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-pair-read-read-first-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-pair-read-read-first-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"' and a.pid=any(pg_blocking_pids(b.pid)))'"'"'); [ "$overlap" = t ] && break; sleep 0.025; done; printf '"'"'%s\n'"'"' "$overlap" > /tmp/r1-pair-read-read-first-overlap; wait "$first"; a=$?; wait "$second"; b=$?; printf '"'"'%s %s\n'"'"' "$a" "$b" > /tmp/r1-pair-read-read-first-exits'
do $race$ begin if btrim(pg_read_file('/tmp/r1-pair-read-read-first-held'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-pair-read-read-first-overlap'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-pair-read-read-first-exits'),E' \n\r\t') not in ('0 0') then raise exception 'PAIR_READ_OVERLAP_FAILED_read-first'; end if; end $race$;
insert into projectceo_foundation.project_member_capabilities(organization_id,project_id,user_id,capability) select organization_id,project_id,actor_id,'view_project' from r1_validation_fixture.sheet_sidecar_read_context;
do $overlap_no_writes$ begin
 if exists(select 1 from pair_overlap_counts b where b.confirmations<>(select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) or b.commands<>(select count(*) from remhaos_integration.command_records) or b.audits<>(select count(*) from remhaos_integration.audit_events)) then raise exception 'PAIR_READ_OVERLAP_WROTE_DOMAIN_STATE'; end if;
end $overlap_no_writes$;
select 'R1_SHEET_SIDECAR_READ_REVOCATION_OVERLAP_OK' as result;
\endif
