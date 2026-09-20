\set ON_ERROR_STOP on
-- Requires fixture74 kept with genuine synthetic A/B/D/E source lineage.
-- Module operations below affect this disposable transaction only, then rollback.
begin;
select set_config('r1_pair.actor',actor_id::text,true),set_config('r1_pair.project',project_id::text,true),set_config('r1_pair.confirmation',confirmation_id::text,true),set_config('r1_pair.sheet',sheet_id,true),set_config('r1_pair.revision',sheet_revision_id,true),set_config('request.jwt.claim.sub',actor_id::text,true) from r1_validation_fixture.sheet_sidecar_context;
create temporary table pair_door_before as select organization_id,project_id,state_revision from project_intelligence.project_workflows where project_id=current_setting('r1_pair.project')::uuid;
create temporary table sidecar_door_counts as select
 (select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) sidecars,
 (select count(*) from remhaos_integration.command_records) commands,
 (select count(*) from remhaos_integration.audit_events) audits;
select projectceo_platform.close_module_production('m3','synthetic request-door test','verify default denial');
set local role authenticated;
do $closed$ begin
 begin
  perform projectceo_api.bind_pdf_dwg_sheet_sidecar(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.confirmation')::uuid,current_setting('r1_pair.sheet'),current_setting('r1_pair.revision'),0,'{"left":0,"top":0,"right":1,"bottom":1}',90,'mm','[1,0,0,1,0,0]','synthetic door','sheet-sidecar-door');
  raise exception 'PAIR_DOOR_OPEN_WHEN_M3_CLOSED';
 exception when insufficient_privilege then null; end;
end $closed$;
reset role;
do $counts$ begin if exists(select 1 from sidecar_door_counts b where b.sidecars+0<>(select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) or b.commands+0<>(select count(*) from remhaos_integration.command_records) or b.audits+0<>(select count(*) from remhaos_integration.audit_events)) then raise exception 'SIDECAR_CLOSED_CALL_WROTE';end if;end $counts$;
select projectceo_platform.open_module_production('m3','synthetic request-door test','verify exact wrapper grant');
set local role authenticated;
do $open$ declare response jsonb; replay jsonb; begin
 response:=projectceo_api.bind_pdf_dwg_sheet_sidecar(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.confirmation')::uuid,current_setting('r1_pair.sheet'),current_setting('r1_pair.revision'),0,'{"left":0,"top":0,"right":1,"bottom":1}',90,'mm','[1,0,0,1,0,0]','synthetic door','sheet-sidecar-door');
 perform set_config('r1_sidecar.response',response::text,true);
end $open$;
reset role;
do $counts$ begin if exists(select 1 from sidecar_door_counts b where b.sidecars+1<>(select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) or b.commands+1<>(select count(*) from remhaos_integration.command_records) or b.audits+1<>(select count(*) from remhaos_integration.audit_events)) then raise exception 'SIDECAR_FIRST_CALL_EFFECT_COUNTS';end if;end $counts$;
set local role authenticated;
do $open$ declare response jsonb:=current_setting('r1_sidecar.response')::jsonb;replay jsonb;begin
 replay:=projectceo_api.bind_pdf_dwg_sheet_sidecar(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.confirmation')::uuid,current_setting('r1_pair.sheet'),current_setting('r1_pair.revision'),0,'{"left":0,"top":0,"right":1,"bottom":1}',90,'mm','[1,0,0,1,0,0]','synthetic door','sheet-sidecar-door');
 perform set_config('r1_sidecar.replay',replay::text,true);
end $open$;
reset role;
do $counts$ begin if exists(select 1 from sidecar_door_counts b where b.sidecars+1<>(select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) or b.commands+1<>(select count(*) from remhaos_integration.command_records) or b.audits+1<>(select count(*) from remhaos_integration.audit_events)) then raise exception 'SIDECAR_REPLAY_WROTE';end if;end $counts$;
set local role authenticated;
do $open$ declare response jsonb:=current_setting('r1_sidecar.response')::jsonb;replay jsonb:=current_setting('r1_sidecar.replay')::jsonb;begin
 begin perform 1 from projectceo_foundation.pdf_dwg_sheet_sidecars;raise exception 'SIDECAR_PRIVATE_TABLE_EXPOSED';exception when insufficient_privilege then null;end;
 if replay->>'replay' is distinct from 'true' or replay->'result' is distinct from response->'result' or response#>>'{result,conversionStatus}' is distinct from 'unconfirmed' or response#>>'{result,geometryEvidence}' is distinct from 'architect_declared' or response#>>'{result,pageMetadataVerification}' is distinct from 'not_verified' then raise exception 'PAIR_DOOR_REPLAY_OR_STATUS'; end if;
 begin
  perform projectceo_foundation._bind_pdf_dwg_sheet_sidecar(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.confirmation')::uuid,current_setting('r1_pair.sheet'),current_setting('r1_pair.revision'),0,'{"left":0,"top":0,"right":1,"bottom":1}',90,'mm','[1,0,0,1,0,0]','synthetic door','sheet-sidecar-door');
  raise exception 'PAIR_PRIVATE_COMMAND_EXPOSED';
 exception when insufficient_privilege then null; end;
 begin
  perform projectceo_api.bind_pdf_dwg_sheet_sidecar(current_setting('r1_pair.project')::uuid,'42222222-2222-4222-8222-222222222222',current_setting('r1_pair.confirmation')::uuid,current_setting('r1_pair.sheet'),current_setting('r1_pair.revision'),0,'{"left":0,"top":0,"right":1,"bottom":1}',90,'mm','[1,0,0,1,0,0]','synthetic cross-package','source-pair-cross-package');
  raise exception 'PAIR_DOOR_CROSS_PACKAGE_ALLOWED';
 exception when sqlstate 'P1103' then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 begin
  perform projectceo_api.bind_pdf_dwg_sheet_sidecar(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.confirmation')::uuid,current_setting('r1_pair.sheet'),current_setting('r1_pair.revision'),0,'{"left":0,"top":0,"right":1,"bottom":1}',90,'mm','[1,0,0,1,0,0]','synthetic door','sheet-sidecar-door');
  raise exception 'PAIR_DOOR_UNAUTHENTICATED_REPLAY';
 exception when sqlstate 'P1101' then null; end;
 perform set_config('request.jwt.claim.sub',current_setting('r1_pair.actor'),true);
end $open$;
reset role;
-- Owner role alone must remain denied even when the database module is open.
update projectceo_foundation.project_memberships set role='owner_lead' where project_id=current_setting('r1_pair.project')::uuid and user_id=auth.uid();
set local role authenticated;
do $owner$ begin
 begin
  perform projectceo_api.bind_pdf_dwg_sheet_sidecar(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.confirmation')::uuid,current_setting('r1_pair.sheet'),current_setting('r1_pair.revision'),0,'{"left":0,"top":0,"right":1,"bottom":1}',90,'mm','[1,0,0,1,0,0]','synthetic door','sheet-sidecar-door');
  raise exception 'PAIR_DOOR_OWNER_SIGNED';
 exception when sqlstate 'P1103' then null; end;
end $owner$;
reset role;
do $acl$ declare r text; begin
 foreach r in array array['anon','service_role','pi_human_executor','pi_worker_executor'] loop
  if has_function_privilege(r,'projectceo_api.bind_pdf_dwg_sheet_sidecar(uuid,uuid,uuid,text,text,bigint,jsonb,integer,text,jsonb,text,text)','EXECUTE') then raise exception 'PAIR_DOOR_NONHUMAN_GRANT'; end if;
 end loop;
 if exists(select 1 from pair_door_before b join project_intelligence.project_workflows p using(organization_id,project_id) where b.state_revision<>p.state_revision) then raise exception 'PAIR_DOOR_MUTATED_GLOBAL_REVISION'; end if;
end $acl$;
select projectceo_platform.close_module_production('m3','synthetic request-door test','verify final denial');
do $after$ begin if has_function_privilege('authenticated','projectceo_api.bind_pdf_dwg_sheet_sidecar(uuid,uuid,uuid,text,text,bigint,jsonb,integer,text,jsonb,text,text)','EXECUTE') then raise exception 'PAIR_DOOR_CLOSE_FAILED'; end if; end $after$;
set local role authenticated;
do $closed_replay$ begin
 begin
  perform projectceo_api.bind_pdf_dwg_sheet_sidecar(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.confirmation')::uuid,current_setting('r1_pair.sheet'),current_setting('r1_pair.revision'),0,'{"left":0,"top":0,"right":1,"bottom":1}',90,'mm','[1,0,0,1,0,0]','synthetic door','sheet-sidecar-door');
  raise exception 'PAIR_DOOR_REPLAY_AFTER_CLOSE';
 exception when insufficient_privilege then null; end;
end $closed_replay$;
reset role;
do $counts$ begin if exists(select 1 from sidecar_door_counts b where b.sidecars+1<>(select count(*) from projectceo_foundation.pdf_dwg_sheet_sidecars) or b.commands+1<>(select count(*) from remhaos_integration.command_records) or b.audits+1<>(select count(*) from remhaos_integration.audit_events)) then raise exception 'SIDECAR_DENIED_CALL_WROTE';end if;end $counts$;
rollback;
select 'R1_SHEET_SIDECAR_REQUEST_DOOR_OK' as result;
