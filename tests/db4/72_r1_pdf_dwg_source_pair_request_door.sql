\set ON_ERROR_STOP on
-- Requires fixture71 kept with genuine synthetic A/B/D/E source lineage.
-- Module operations below affect this disposable transaction only, then rollback.
begin;
select set_config('r1_pair.actor',actor_id::text,true),set_config('r1_pair.project',project_id::text,true),set_config('r1_pair.dwg',dwg_id::text,true),set_config('r1_pair.pdf',pdf_id::text,true),set_config('request.jwt.claim.sub',actor_id::text,true) from r1_validation_fixture.source_pair_context;
create temporary table pair_door_before as select organization_id,project_id,state_revision from project_intelligence.project_workflows where project_id=current_setting('r1_pair.project')::uuid;
select projectceo_platform.close_module_production('m3','synthetic request-door test','verify default denial');
set local role authenticated;
do $closed$ begin
 begin
  perform projectceo_api.confirm_pdf_dwg_source_pair(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.dwg')::uuid,current_setting('r1_pair.pdf')::uuid,'synthetic door','source-pair-door');
  raise exception 'PAIR_DOOR_OPEN_WHEN_M3_CLOSED';
 exception when insufficient_privilege then null; end;
end $closed$;
reset role;
select projectceo_platform.open_module_production('m3','synthetic request-door test','verify exact wrapper grant');
set local role authenticated;
do $open$ declare response jsonb; replay jsonb; begin
 response:=projectceo_api.confirm_pdf_dwg_source_pair(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.dwg')::uuid,current_setting('r1_pair.pdf')::uuid,'synthetic door','source-pair-door');
 replay:=projectceo_api.confirm_pdf_dwg_source_pair(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.dwg')::uuid,current_setting('r1_pair.pdf')::uuid,'synthetic door','source-pair-door');
 if replay->>'replay' is distinct from 'true' or replay->'result' is distinct from response->'result' or response#>>'{result,conversionStatus}' is distinct from 'unconfirmed' then raise exception 'PAIR_DOOR_REPLAY_OR_STATUS'; end if;
 begin
  perform projectceo_foundation._confirm_pdf_dwg_source_pair(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.dwg')::uuid,current_setting('r1_pair.pdf')::uuid,'synthetic door','source-pair-door');
  raise exception 'PAIR_PRIVATE_COMMAND_EXPOSED';
 exception when insufficient_privilege then null; end;
 begin
  perform projectceo_api.confirm_pdf_dwg_source_pair(current_setting('r1_pair.project')::uuid,'42222222-2222-4222-8222-222222222222',current_setting('r1_pair.dwg')::uuid,current_setting('r1_pair.pdf')::uuid,'synthetic cross-package','source-pair-cross-package');
  raise exception 'PAIR_DOOR_CROSS_PACKAGE_ALLOWED';
 exception when sqlstate 'P1103' then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 begin
  perform projectceo_api.confirm_pdf_dwg_source_pair(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.dwg')::uuid,current_setting('r1_pair.pdf')::uuid,'synthetic door','source-pair-door');
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
  perform projectceo_api.confirm_pdf_dwg_source_pair(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.dwg')::uuid,current_setting('r1_pair.pdf')::uuid,'synthetic door','source-pair-door');
  raise exception 'PAIR_DOOR_OWNER_SIGNED';
 exception when sqlstate 'P1103' then null; end;
end $owner$;
reset role;
do $acl$ declare r text; begin
 foreach r in array array['anon','service_role','pi_human_executor','pi_worker_executor'] loop
  if has_function_privilege(r,'projectceo_api.confirm_pdf_dwg_source_pair(uuid,uuid,uuid,uuid,text,text)','EXECUTE') then raise exception 'PAIR_DOOR_NONHUMAN_GRANT'; end if;
 end loop;
 if exists(select 1 from pair_door_before b join project_intelligence.project_workflows p using(organization_id,project_id) where b.state_revision<>p.state_revision) then raise exception 'PAIR_DOOR_MUTATED_GLOBAL_REVISION'; end if;
end $acl$;
select projectceo_platform.close_module_production('m3','synthetic request-door test','verify final denial');
do $after$ begin if has_function_privilege('authenticated','projectceo_api.confirm_pdf_dwg_source_pair(uuid,uuid,uuid,uuid,text,text)','EXECUTE') then raise exception 'PAIR_DOOR_CLOSE_FAILED'; end if; end $after$;
set local role authenticated;
do $closed_replay$ begin
 begin
  perform projectceo_api.confirm_pdf_dwg_source_pair(current_setting('r1_pair.project')::uuid,current_setting('r1_pair.project')::uuid,current_setting('r1_pair.dwg')::uuid,current_setting('r1_pair.pdf')::uuid,'synthetic door','source-pair-door');
  raise exception 'PAIR_DOOR_REPLAY_AFTER_CLOSE';
 exception when insufficient_privilege then null; end;
end $closed_replay$;
reset role;
rollback;
select 'R1_SOURCE_PAIR_REQUEST_DOOR_OK' as result;
