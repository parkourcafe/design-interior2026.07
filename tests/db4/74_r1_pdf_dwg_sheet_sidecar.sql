\set ON_ERROR_STOP on
-- Requires genuine native M3 sheet fixture34 and accepted source-pair fixture71.
-- With r1_sheet_sidecar_keep_fixture=1 the durable context contains exact
-- organization/project/actor/confirmation/sheet/revision/expected_result.
-- External overlap harness: revoke project_member_capabilities.review_source
-- for context.actor_id while holding that row through PgSleep; invoke the private
-- command with context selectors and the fixed geometry/reason/key below.
-- Actor is the synthetic project architect; exact package capability fallback
-- must be checked absent by the harness before a project-capability revoke test.
-- The context remains on the original pair/sheet after new-version negatives.
\if :{?r1_sheet_sidecar_restart_check}
begin;
select set_config('request.jwt.claim.sub',actor_id::text,true) from r1_validation_fixture.sheet_sidecar_context;
do $restart$ declare c r1_validation_fixture.sheet_sidecar_context%rowtype; r jsonb;begin
 select * into strict c from r1_validation_fixture.sheet_sidecar_context;
 r:=projectceo_foundation._bind_pdf_dwg_sheet_sidecar(c.project_id,c.project_id,c.confirmation_id,c.sheet_id,c.sheet_revision_id,0,'{"left":0,"top":0,"right":1,"bottom":1}',90,'mm','[1,0,0,1,0,0]','synthetic sidecar','sidecar-first');
 if r->>'replay' is distinct from 'true' or r->'result' is distinct from c.expected_result then raise exception 'SIDECAR_RESTART_CHANGED';end if;
end $restart$;
rollback;
select 'R1_SHEET_SIDECAR_RESTART_OK' result;
\else
begin;
create table r1_validation_fixture.sheet_sidecar_context as
select c.organization_id,c.project_id,c.actor_id,(c.expected_result->>'confirmationId')::uuid confirmation_id,d.sheet_id,d.revision_id sheet_revision_id,null::jsonb expected_result
from r1_validation_fixture.source_pair_context c join projectceo_m3.documentation_sheet_revisions d
on d.organization_id=c.organization_id and d.project_id=c.project_id and d.package_id=c.project_id
where d.sheet_id='m3-sheet-a101' and d.revision_id='75000000-0000-4000-8000-000000000001';
create function pg_temp.sidecar(p_key text,p_matrix jsonb default '[1,0,0,1,0,0]',p_page bigint default 0,p_rotation integer default 90) returns jsonb language plpgsql as $f$
declare c r1_validation_fixture.sheet_sidecar_context%rowtype;begin select * into strict c from r1_validation_fixture.sheet_sidecar_context;
 return projectceo_foundation._bind_pdf_dwg_sheet_sidecar(c.project_id,c.project_id,c.confirmation_id,c.sheet_id,c.sheet_revision_id,p_page,'{"left":0,"top":0,"right":1,"bottom":1}',p_rotation,'mm',p_matrix,'synthetic sidecar',p_key);end $f$;
create function r1_validation_fixture.sidecar_late_failure() returns trigger language plpgsql as $f$
begin if new.operation='bind_pdf_dwg_sheet_sidecar' and new.key_digest=project_intelligence._sha256_text('sidecar-late') then raise sqlstate 'P9003';end if;return new;end $f$;
create trigger sidecar_late_failure before insert on remhaos_integration.command_records for each row execute function r1_validation_fixture.sidecar_late_failure();
do $behavior$
declare c r1_validation_fixture.sheet_sidecar_context%rowtype;r jsonb;replay jsonb;snapshot jsonb;bad jsonb;before_counts jsonb;role_name text;rotation integer; other_pair uuid; changed jsonb;
begin
 select * into strict c from r1_validation_fixture.sheet_sidecar_context;
 perform set_config('request.jwt.claim.sub',c.actor_id::text,true);
 select jsonb_build_object('representations',(select count(*) from projectceo_foundation.external_representation_versions),'refs',(select count(*) from projectceo_foundation.technical_reference_versions),'sheets',(select count(*) from projectceo_m3.documentation_sheet_revisions)) into before_counts;
 foreach bad in array array['[1,2,2,4,0,0]'::jsonb,'[1e308,1e308,1e308,1e308,0,0]','[1e-308,0,0,1,1e308,0]','[1e308,0,1e308,1,0,0]','[1,0,0,1,0]','[1,"x",0,1,0,0]'] loop
  begin perform pg_temp.sidecar('invalid-geometry',bad);raise exception 'SIDECAR_INVALID_GEOMETRY_ALLOWED';exception when sqlstate 'P1111' then null;end;
 end loop;
 if projectceo_foundation._valid_pdf_sheet_geometry(0,'{"left":0,"top":0,"right":0,"bottom":1}',0,'mm','[1,0,0,1,0,0]') or projectceo_foundation._valid_pdf_sheet_geometry(-1,'{"left":0,"top":0,"right":1,"bottom":1}',0,'mm','[1,0,0,1,0,0]') or projectceo_foundation._valid_pdf_sheet_geometry(0,'{"left":0,"top":0,"right":1,"bottom":1}',45,'mm','[1,0,0,1,0,0]') then raise exception 'SIDECAR_BAD_PAGE_CROP_ROTATION';end if;
 foreach bad in array array[
  '{"left":0,"top":0,"right":1.00000000000000001,"bottom":1}'::jsonb,
  '{"left":-0.000000000000000000001,"top":0,"right":1,"bottom":1}',
  '{"left":0.50000000000000002,"top":0,"right":0.50000000000000001,"bottom":1}',
  '{"left":0,"top":0.50000000000000002,"right":1,"bottom":0.50000000000000001}'
 ] loop
  if projectceo_foundation._valid_pdf_sheet_geometry(0,bad,0,'mm','[1,0,0,1,0,0]') then raise exception 'SIDECAR_EXACT_NUMERIC_CROP_ACCEPTED';end if;
 end loop;
 set constraints all immediate;
 r:=pg_temp.sidecar('sidecar-first');
 update r1_validation_fixture.sheet_sidecar_context set expected_result=r->'result';
 if r#>>'{result,geometryEvidence}' is distinct from 'architect_declared' or r#>>'{result,pageMetadataVerification}' is distinct from 'not_verified' or r#>>'{result,conversionStatus}' is distinct from 'unconfirmed' then raise exception 'SIDECAR_FALSE_GEOMETRY_PROOF';end if;
 replay:=pg_temp.sidecar('sidecar-first');if replay->>'replay' is distinct from 'true' or replay->'result' is distinct from r->'result' then raise exception 'SIDECAR_REPLAY_CHANGED';end if;
 perform set_config('TimeZone','Asia/Tashkent',true);if pg_temp.sidecar('sidecar-first')->'result' is distinct from r->'result' then raise exception 'SIDECAR_TIMEZONE';end if;
 begin perform pg_temp.sidecar('sidecar-first','[1,0,0,1,0,0]',1);raise exception 'SIDECAR_PAGE_REPLAY_CHANGED';exception when sqlstate 'P1208' then null;end;
 foreach rotation in array array[0,180,270] loop
  replay:=pg_temp.sidecar('rotation-'||rotation,'[1,0,0,1,0,0]',0,rotation);
  if (replay#>>'{result,rotationDegrees}')::integer<>rotation or replay#>'{result,pageToPreviewTransform}'<>'[1,0,0,1,0,0]'::jsonb then raise exception 'SIDECAR_DECLARED_VALUES_CHANGED';end if;
 end loop;
 select to_jsonb(x) into strict snapshot from projectceo_foundation.pdf_dwg_sheet_sidecars x where sidecar_id=(r#>>'{result,sidecarId}')::uuid;
 -- A different genuine native sheet revision cannot reuse the old key.
 update r1_validation_fixture.sheet_sidecar_context set sheet_revision_id='75000000-0000-4000-8000-000000000002';
 begin perform pg_temp.sidecar('sidecar-first');raise exception 'SIDECAR_NEW_SHEET_REPLAY_ALLOWED';exception when sqlstate 'P1208' then null;end;
 changed:=pg_temp.sidecar('sidecar-second-sheet');
 if changed#>>'{result,sidecarId}'=r#>>'{result,sidecarId}' or changed#>>'{result,sheetRevisionId}'<>'75000000-0000-4000-8000-000000000002' then raise exception 'SIDECAR_NEW_SHEET_IDENTITY';end if;
 update r1_validation_fixture.sheet_sidecar_context set sheet_revision_id=c.sheet_revision_id;
 select confirmation_id into strict other_pair from projectceo_foundation.pdf_dwg_source_pair_confirmations pair where pair.organization_id=c.organization_id and pair.project_id=c.project_id and pair.package_id=c.project_id and pair.confirmation_id<>c.confirmation_id order by confirmation_id limit 1;
 update r1_validation_fixture.sheet_sidecar_context set confirmation_id=other_pair;
 begin perform pg_temp.sidecar('sidecar-first');raise exception 'SIDECAR_NEW_PAIR_REPLAY_ALLOWED';exception when sqlstate 'P1208' then null;end;
 changed:=pg_temp.sidecar('sidecar-second-pair');
 if changed#>>'{result,sidecarId}'=r#>>'{result,sidecarId}' or (changed#>>'{result,confirmationId}')::uuid<>other_pair then raise exception 'SIDECAR_NEW_PAIR_IDENTITY';end if;
 update r1_validation_fixture.sheet_sidecar_context set confirmation_id=c.confirmation_id;
 begin
  perform projectceo_foundation._bind_pdf_dwg_sheet_sidecar(c.project_id,c.project_id,c.confirmation_id,'missing-sheet',c.sheet_revision_id,0,'{"left":0,"top":0,"right":1,"bottom":1}',0,'mm','[1,0,0,1,0,0]','synthetic','unknown-sheet');
  raise exception 'SIDECAR_UNKNOWN_SHEET_ALLOWED';exception when sqlstate 'P1104' then null;end;
 begin
  perform projectceo_foundation._bind_pdf_dwg_sheet_sidecar(c.project_id,'42222222-2222-4222-8222-222222222222',c.confirmation_id,c.sheet_id,c.sheet_revision_id,0,'{"left":0,"top":0,"right":1,"bottom":1}',0,'mm','[1,0,0,1,0,0]','synthetic','wrong-package');
  raise exception 'SIDECAR_WRONG_PACKAGE_ALLOWED';exception when sqlstate 'P1103' then null;end;
 begin update projectceo_foundation.pdf_dwg_sheet_sidecars set units='cm' where sidecar_id=(r#>>'{result,sidecarId}')::uuid;raise exception 'SIDECAR_UPDATE';exception when sqlstate '55000' then null;end;
 begin delete from projectceo_foundation.pdf_dwg_sheet_sidecars where sidecar_id=(r#>>'{result,sidecarId}')::uuid;raise exception 'SIDECAR_DELETE';exception when sqlstate '55000' then null;end;
 begin update projectceo_foundation.project_memberships set role='owner_lead' where project_id=c.project_id and user_id=c.actor_id;begin perform pg_temp.sidecar('sidecar-first');raise exception 'SIDECAR_OWNER_ALLOWED';exception when sqlstate 'P1103' then null;end;raise sqlstate 'P9001';exception when sqlstate 'P9001' then null;end;
 begin update remhaos_integration.external_upload_policy_heads set write_eligible=false,revision=revision+1 where project_id=c.project_id;begin perform pg_temp.sidecar('sidecar-first');raise exception 'SIDECAR_WRITE_DISABLED';exception when sqlstate 'P1103' then null;end;raise sqlstate 'P9001';exception when sqlstate 'P9001' then null;end;
 begin perform pg_temp.sidecar('sidecar-late');raise exception 'SIDECAR_LATE_FAILURE';exception when sqlstate 'P9003' then null;end;
 if exists(select 1 from projectceo_foundation.pdf_dwg_sheet_sidecars where key_digest=project_intelligence._sha256_text('sidecar-late')) then raise exception 'SIDECAR_LATE_EFFECT';end if;
 begin
  insert into projectceo_foundation.pdf_dwg_sheet_sidecars select (jsonb_populate_record(null::projectceo_foundation.pdf_dwg_sheet_sidecars,snapshot||jsonb_build_object('sidecar_id',extensions.gen_random_uuid(),'key_digest',project_intelligence._sha256_text('orphan')))).*;
  set constraints projectceo_foundation.r1_sheet_sidecar_receipt_closure immediate;raise exception 'SIDECAR_ORPHAN_ALLOWED';exception when no_data_found then null;end;
 begin
  set constraints remhaos_integration.r1_sheet_sidecar_command_closure deferred;
  insert into remhaos_integration.command_records(organization_id,project_id,operation,key_digest,request_digest,actor_type,actor_id,actor_user_id,logical_result)
  values(c.organization_id,c.project_id,'bind_pdf_dwg_sheet_sidecar',project_intelligence._sha256_text('sidecar-orphan-command'),project_intelligence._sha256_text('synthetic orphan'),'human',c.actor_id::text,c.actor_id,r->'result');
  set constraints remhaos_integration.r1_sheet_sidecar_command_closure immediate;raise exception 'SIDECAR_ORPHAN_COMMAND_ALLOWED';
 exception when no_data_found then null;end;
 if exists(select 1 from remhaos_integration.command_records where organization_id=c.organization_id and project_id=c.project_id and operation='bind_pdf_dwg_sheet_sidecar' and key_digest=project_intelligence._sha256_text('sidecar-orphan-command')) then raise exception 'SIDECAR_ORPHAN_COMMAND_REMAINED';end if;
 begin
  insert into remhaos_integration.audit_events(organization_id,project_id,command_id,actor_type,actor_id,action,outcome_code,correlation_id,sanitized_metadata)
  select organization_id,project_id,command_id,'human',actor_id,'bind_pdf_dwg_sheet_sidecar','ok','synthetic:extra-sidecar-audit','{}' from remhaos_integration.command_records where organization_id=c.organization_id and project_id=c.project_id and operation='bind_pdf_dwg_sheet_sidecar' and key_digest=project_intelligence._sha256_text('sidecar-first');
  set constraints remhaos_integration.r1_sheet_sidecar_audit_closure immediate;raise exception 'SIDECAR_EXTRA_AUDIT_ALLOWED';
 exception when raise_exception then if sqlerrm<>'R1_SIDECAR_AUDIT_MISMATCH' then raise;end if;end;
 if snapshot is distinct from (select to_jsonb(x) from projectceo_foundation.pdf_dwg_sheet_sidecars x where sidecar_id=(r#>>'{result,sidecarId}')::uuid) then raise exception 'SIDECAR_HISTORY_MUTATED';end if;
 if before_counts is distinct from jsonb_build_object('representations',(select count(*) from projectceo_foundation.external_representation_versions),'refs',(select count(*) from projectceo_foundation.technical_reference_versions),'sheets',(select count(*) from projectceo_m3.documentation_sheet_revisions)) then raise exception 'SIDECAR_SYNTHESIZED_DOMAIN_OBJECTS';end if;
 foreach role_name in array array['anon','authenticated','service_role','pi_human_executor','pi_worker_executor'] loop if has_function_privilege(role_name,'projectceo_foundation._bind_pdf_dwg_sheet_sidecar(uuid,uuid,uuid,text,text,bigint,jsonb,integer,text,jsonb,text,text)','EXECUTE') then raise exception 'SIDECAR_RUNTIME_GRANT';end if;end loop;
 set constraints all immediate;
end $behavior$;
\if :{?r1_sheet_sidecar_keep_fixture}
commit;
\else
rollback;
\endif
select 'R1_SHEET_SIDECAR_BEHAVIOR_OK' result;
\endif

\if :{?r1_sheet_sidecar_overlap}
do $precondition$ begin
 if (select count(*) from r1_validation_fixture.sheet_sidecar_context)<>1 or not exists(select 1 from projectceo_foundation.project_member_capabilities pc join r1_validation_fixture.sheet_sidecar_context c using(organization_id,project_id) where pc.user_id=c.actor_id and pc.capability='review_source') or exists(select 1 from projectceo_foundation.package_member_capabilities pc join r1_validation_fixture.sheet_sidecar_context c using(organization_id,project_id) where pc.user_id=c.actor_id and pc.package_id=c.project_id and pc.capability='review_source') then raise exception 'SIDECAR_RACE_AUTHORITY_PRECONDITION';end if;
end $precondition$;
create temporary table sidecar_race_counts as select
 (select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) sidecars,
 (select count(*) from remhaos_integration.command_records) commands,
 (select count(*) from remhaos_integration.audit_events) audits,
 (select jsonb_agg(to_jsonb(r) order by sidecar_id) from projectceo_foundation.pdf_dwg_sheet_sidecars r) old_sidecars,
 (select jsonb_agg(to_jsonb(r) order by confirmation_id) from projectceo_foundation.pdf_dwg_source_pair_confirmations r) pairs,
 (select jsonb_agg(to_jsonb(r) order by organization_id,project_id,sheet_id,revision_id) from projectceo_m3.documentation_sheet_revisions r) sheets,
 (select jsonb_agg(to_jsonb(r) order by organization_id,project_id) from project_intelligence.project_workflows r) workflows;
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-sidecar-revoke-first-1'"'"'"'"'"'"'"'"'; begin; delete from projectceo_foundation.project_member_capabilities pc using r1_validation_fixture.sheet_sidecar_context c where pc.organization_id=c.organization_id and pc.project_id=c.project_id and pc.user_id=c.actor_id and pc.capability='"'"'"'"'"'"'"'"'review_source'"'"'"'"'"'"'"'"'; select pg_sleep(3); commit;'"'"' > /tmp/r1-sidecar-revoke-first-1.log 2>&1 & first=$!; held=f; for i in $(seq 1 40); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-sidecar-revoke-first-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.025; done; printf '"'"'%s\n'"'"' "$held" > /tmp/r1-sidecar-revoke-first-held; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-sidecar-revoke-first-2'"'"'"'"'"'"'"'"'; begin; select set_config('"'"'"'"'"'"'"'"'request.jwt.claim.sub'"'"'"'"'"'"'"'"',actor_id::text,true) from r1_validation_fixture.sheet_sidecar_context; select projectceo_foundation._bind_pdf_dwg_sheet_sidecar(project_id,project_id,confirmation_id,sheet_id,sheet_revision_id,0,'"'"'"'"'"'"'"'"'{"left":0,"top":0,"right":1,"bottom":1}'"'"'"'"'"'"'"'"',90,'"'"'"'"'"'"'"'"'mm'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'[1,0,0,1,0,0]'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'synthetic sidecar'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'sidecar-race-revoked'"'"'"'"'"'"'"'"') from r1_validation_fixture.sheet_sidecar_context; commit;'"'"' > /tmp/r1-sidecar-revoke-first-2.log 2>&1 & second=$!; overlap=f; for i in $(seq 1 40); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-sidecar-revoke-first-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-sidecar-revoke-first-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"' and a.pid=any(pg_blocking_pids(b.pid)))'"'"'); [ "$overlap" = t ] && break; sleep 0.025; done; printf '"'"'%s\n'"'"' "$overlap" > /tmp/r1-sidecar-revoke-first-overlap; wait "$first"; a=$?; wait "$second"; b=$?; printf '"'"'%s %s\n'"'"' "$a" "$b" > /tmp/r1-sidecar-revoke-first-exits'
do $race$ begin if btrim(pg_read_file('/tmp/r1-sidecar-revoke-first-held'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-sidecar-revoke-first-overlap'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-sidecar-revoke-first-exits'),E' \n\r\t') not in ('0 1','0 3') or position('forbidden' in pg_read_file('/tmp/r1-sidecar-revoke-first-2.log'))=0 then raise exception 'SIDECAR_OVERLAP_FAILED_revoke-first';end if;end $race$;
insert into projectceo_foundation.project_member_capabilities(organization_id,project_id,user_id,capability) select organization_id,project_id,actor_id,'review_source' from r1_validation_fixture.sheet_sidecar_context;
\! sh -c 'psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-sidecar-command-first-1'"'"'"'"'"'"'"'"'; begin; select set_config('"'"'"'"'"'"'"'"'request.jwt.claim.sub'"'"'"'"'"'"'"'"',actor_id::text,true) from r1_validation_fixture.sheet_sidecar_context; select projectceo_foundation._bind_pdf_dwg_sheet_sidecar(project_id,project_id,confirmation_id,sheet_id,sheet_revision_id,0,'"'"'"'"'"'"'"'"'{"left":0,"top":0,"right":1,"bottom":1}'"'"'"'"'"'"'"'"',90,'"'"'"'"'"'"'"'"'mm'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'[1,0,0,1,0,0]'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'synthetic sidecar'"'"'"'"'"'"'"'"','"'"'"'"'"'"'"'"'sidecar-race-success'"'"'"'"'"'"'"'"') from r1_validation_fixture.sheet_sidecar_context; select pg_sleep(3); commit;'"'"' > /tmp/r1-sidecar-command-first-1.log 2>&1 & first=$!; held=f; for i in $(seq 1 40); do held=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity where application_name='"'"'"'"'"'"'"'"'r1-sidecar-command-first-1'"'"'"'"'"'"'"'"' and wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"')'"'"'); [ "$held" = t ] && break; sleep 0.025; done; printf '"'"'%s\n'"'"' "$held" > /tmp/r1-sidecar-command-first-held; psql -X --set ON_ERROR_STOP=1 --username postgres --dbname pi_db4 --command '"'"'set application_name='"'"'"'"'"'"'"'"'r1-sidecar-command-first-2'"'"'"'"'"'"'"'"'; begin; delete from projectceo_foundation.project_member_capabilities pc using r1_validation_fixture.sheet_sidecar_context c where pc.organization_id=c.organization_id and pc.project_id=c.project_id and pc.user_id=c.actor_id and pc.capability='"'"'"'"'"'"'"'"'review_source'"'"'"'"'"'"'"'"'; commit;'"'"' > /tmp/r1-sidecar-command-first-2.log 2>&1 & second=$!; overlap=f; for i in $(seq 1 40); do overlap=$(psql -X --tuples-only --no-align --username postgres --dbname pi_db4 --command '"'"'select exists(select 1 from pg_stat_activity a,pg_stat_activity b where a.application_name='"'"'"'"'"'"'"'"'r1-sidecar-command-first-1'"'"'"'"'"'"'"'"' and a.wait_event='"'"'"'"'"'"'"'"'PgSleep'"'"'"'"'"'"'"'"' and b.application_name='"'"'"'"'"'"'"'"'r1-sidecar-command-first-2'"'"'"'"'"'"'"'"' and b.wait_event_type='"'"'"'"'"'"'"'"'Lock'"'"'"'"'"'"'"'"' and a.pid=any(pg_blocking_pids(b.pid)))'"'"'); [ "$overlap" = t ] && break; sleep 0.025; done; printf '"'"'%s\n'"'"' "$overlap" > /tmp/r1-sidecar-command-first-overlap; wait "$first"; a=$?; wait "$second"; b=$?; printf '"'"'%s %s\n'"'"' "$a" "$b" > /tmp/r1-sidecar-command-first-exits'
do $race$ begin if btrim(pg_read_file('/tmp/r1-sidecar-command-first-held'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-sidecar-command-first-overlap'),E' \n\r\t')<>'t' or btrim(pg_read_file('/tmp/r1-sidecar-command-first-exits'),E' \n\r\t') not in ('0 0') then raise exception 'SIDECAR_OVERLAP_FAILED_command-first';end if;end $race$;
insert into projectceo_foundation.project_member_capabilities(organization_id,project_id,user_id,capability) select organization_id,project_id,actor_id,'review_source' from r1_validation_fixture.sheet_sidecar_context;
do $effects$ declare r projectceo_foundation.pdf_dwg_sheet_sidecars%rowtype;c r1_validation_fixture.sheet_sidecar_context%rowtype;begin
 select * into strict c from r1_validation_fixture.sheet_sidecar_context;
 if exists(select 1 from projectceo_foundation.pdf_dwg_sheet_sidecars where key_digest=project_intelligence._sha256_text('sidecar-race-revoked')) or exists(select 1 from remhaos_integration.command_records where operation='bind_pdf_dwg_sheet_sidecar' and key_digest=project_intelligence._sha256_text('sidecar-race-revoked')) then raise exception 'SIDECAR_REVOKE_FIRST_WROTE';end if;
 select * into strict r from projectceo_foundation.pdf_dwg_sheet_sidecars where organization_id=c.organization_id and project_id=c.project_id and key_digest=project_intelligence._sha256_text('sidecar-race-success');
 if r.confirmation_id<>c.confirmation_id or r.sheet_id<>c.sheet_id or r.sheet_revision_id<>c.sheet_revision_id or r.created_by_user_id<>c.actor_id or r.pdf_page_index<>0 or r.pdf_crop<>'{"left":0,"top":0,"right":1,"bottom":1}'::jsonb or r.rotation_degrees<>90 or r.units<>'mm' or r.page_to_preview_transform<>'[1,0,0,1,0,0]'::jsonb then raise exception 'SIDECAR_COMMAND_FIRST_WRONG_RECEIPT';end if;
 perform projectceo_foundation._assert_pdf_sheet_sidecar(c.organization_id,c.project_id,r.key_digest);
 if exists(select 1 from sidecar_race_counts b where b.sidecars+1<>(select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) or b.commands+1<>(select count(*) from remhaos_integration.command_records) or b.audits+1<>(select count(*) from remhaos_integration.audit_events)
 or b.old_sidecars is distinct from (select jsonb_agg(to_jsonb(x) order by sidecar_id) from projectceo_foundation.pdf_dwg_sheet_sidecars x where x.sidecar_id<>r.sidecar_id)
 or b.pairs is distinct from (select jsonb_agg(to_jsonb(x) order by confirmation_id) from projectceo_foundation.pdf_dwg_source_pair_confirmations x)
 or b.sheets is distinct from (select jsonb_agg(to_jsonb(x) order by organization_id,project_id,sheet_id,revision_id) from projectceo_m3.documentation_sheet_revisions x)
 or b.workflows is distinct from (select jsonb_agg(to_jsonb(x) order by organization_id,project_id) from project_intelligence.project_workflows x)) then raise exception 'SIDECAR_RACE_UNINTENDED_EFFECTS';end if;
end $effects$;
select 'R1_SHEET_SIDECAR_REVOCATION_OVERLAP_OK' result;
\endif
