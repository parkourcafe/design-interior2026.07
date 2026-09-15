-- Thin authenticated M3 door; private command and its helper remain denied.
begin;
create function projectceo_api.confirm_pdf_dwg_source_pair(
 project_id uuid,package_id uuid,dwg_asset_version_id uuid,pdf_asset_version_id uuid,reason text,idempotency_key text
) returns jsonb language sql volatile security definer set search_path='' as $f$
 select projectceo_foundation._confirm_pdf_dwg_source_pair(project_id,package_id,dwg_asset_version_id,pdf_asset_version_id,reason,idempotency_key);
$f$;
alter function projectceo_api.confirm_pdf_dwg_source_pair(uuid,uuid,uuid,uuid,text,text) owner to pi_table_owner;
revoke all on function projectceo_api.confirm_pdf_dwg_source_pair(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
revoke execute on function
  projectceo_api.confirm_pdf_dwg_source_pair(uuid, uuid, uuid, uuid, text, text)
from authenticated;
do $module$
declare before_m3 text[]:=projectceo_platform._module_signatures('m3'); before_m4 text[]:=projectceo_platform._module_signatures('m4_increment_1');
 signature text:='projectceo_api.confirm_pdf_dwg_source_pair(uuid, uuid, uuid, uuid, text, text)'; definition text; owner_id oid; acl aclitem[];
begin
 select pg_get_functiondef(p.oid),p.proowner,p.proacl into strict definition,owner_id,acl from pg_proc p where p.oid='projectceo_platform._module_signatures(text)'::regprocedure;
 if before_m3 is null or signature=any(before_m3) or position('when ''m3'' then array[' in definition)=0 then raise exception 'R1_PAIR_MODULE_REGISTRY_UNEXPECTED'; end if;
 definition:=replace(definition,'when ''m3'' then array[','when ''m3'' then array['||quote_literal(signature)||',');
 execute definition;
 if projectceo_platform._module_signatures('m3') is distinct from array[signature]||before_m3 or projectceo_platform._module_signatures('m4_increment_1') is distinct from before_m4
 or exists(select 1 from pg_proc p where p.oid='projectceo_platform._module_signatures(text)'::regprocedure and (p.proowner<>owner_id or p.proacl is distinct from acl)) then raise exception 'R1_PAIR_MODULE_REGISTRY_CHANGED'; end if;
end $module$;
commit;
