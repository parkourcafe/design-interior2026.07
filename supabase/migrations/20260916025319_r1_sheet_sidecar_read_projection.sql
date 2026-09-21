-- Historical source-pair metadata; never grants current byte access.
begin;
create function projectceo_read_api.get_pdf_dwg_sheet_sidecar(project_id uuid,package_id uuid,sidecar_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
#variable_conflict use_variable
declare ctx record; receipt projectceo_foundation.pdf_dwg_sheet_sidecars%rowtype;
 p_project_id uuid:=project_id; p_package_id uuid:=package_id;
begin
 select * into strict ctx from projectceo_foundation._authorize_package_human(project_id,package_id,'view_project');
  perform 1 from project_intelligence.project_workflows locked
    where locked.organization_id = ctx.organization_id and locked.project_id = p_project_id for share;
  perform 1 from project_intelligence.organizations locked
    where locked.id = ctx.organization_id for share;
  perform 1 from projectceo_foundation.project_packages locked
    where locked.organization_id = ctx.organization_id and locked.project_id = p_project_id
      and locked.id = p_package_id for share;
  perform 1 from project_intelligence.organization_members locked
    where locked.organization_id = ctx.organization_id and locked.user_id = ctx.actor_user_id for share;
  perform 1 from projectceo_foundation.project_memberships locked
    where locked.organization_id = ctx.organization_id and locked.project_id = p_project_id
      and locked.user_id = ctx.actor_user_id for share;
  perform 1 from projectceo_foundation.project_member_capabilities locked
    where locked.organization_id = ctx.organization_id and locked.project_id = p_project_id
      and locked.user_id = ctx.actor_user_id and locked.capability = 'view_project' for share;
  perform 1 from projectceo_foundation.package_memberships locked
    where locked.organization_id = ctx.organization_id and locked.project_id = p_project_id
      and locked.package_id = p_package_id and locked.user_id = ctx.actor_user_id for share;
  perform 1 from projectceo_foundation.package_member_capabilities locked
    where locked.organization_id = ctx.organization_id and locked.project_id = p_project_id
      and locked.package_id = p_package_id and locked.user_id = ctx.actor_user_id
      and locked.capability = 'view_project' for share;


 select * into strict ctx from projectceo_foundation._authorize_package_human(project_id,package_id,'view_project');
 if not (
  exists(select 1 from projectceo_foundation.project_memberships m where m.organization_id=ctx.organization_id and m.project_id=project_id and m.user_id=ctx.actor_user_id and m.status='active' and m.role in ('owner_lead','architect'))
  or exists(select 1 from projectceo_foundation.package_memberships m where m.organization_id=ctx.organization_id and m.project_id=project_id and m.package_id=package_id and m.user_id=ctx.actor_user_id and m.status='active' and m.role='architect')
 ) then perform projectceo_foundation._raise('P1103','forbidden','{}'); end if;
 if not projectceo_platform.m3_read_gate_open() then perform projectceo_foundation._raise('P1113','module_disabled','{}'); end if;
 select r.* into receipt from projectceo_foundation.pdf_dwg_sheet_sidecars r where r.organization_id=ctx.organization_id and r.project_id=project_id and r.package_id=package_id and r.sidecar_id=sidecar_id;
 if not found then perform projectceo_foundation._raise('P1104','not_found','{}'); end if;
 return jsonb_build_object('contractVersion','r1-sheet-sidecar-read/1','result',projectceo_foundation._pdf_sheet_sidecar_result(receipt));
end $f$;
alter function projectceo_read_api.get_pdf_dwg_sheet_sidecar(uuid,uuid,uuid) owner to pi_table_owner;
revoke all on function projectceo_read_api.get_pdf_dwg_sheet_sidecar(uuid,uuid,uuid) from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
revoke execute on function
  projectceo_read_api.get_pdf_dwg_sheet_sidecar(uuid, uuid, uuid)
from authenticated;
do $module$
declare before_m3 text[]:=projectceo_platform._module_signatures('m3'); before_m4 text[]:=projectceo_platform._module_signatures('m4_increment_1');
 signature text:='projectceo_read_api.get_pdf_dwg_sheet_sidecar(uuid, uuid, uuid)'; definition text; owner_id oid; acl aclitem[];
begin
 select pg_get_functiondef(p.oid),p.proowner,p.proacl into strict definition,owner_id,acl from pg_proc p where p.oid='projectceo_platform._module_signatures(text)'::regprocedure;
 if before_m3 is null or signature=any(before_m3) or position('when ''m3'' then array[' in definition)=0 then raise exception 'R1_PAIR_MODULE_REGISTRY_UNEXPECTED'; end if;
 definition:=replace(definition,'when ''m3'' then array[','when ''m3'' then array['||quote_literal(signature)||',');
 execute definition;
 if projectceo_platform._module_signatures('m3') is distinct from array[signature]||before_m3 or projectceo_platform._module_signatures('m4_increment_1') is distinct from before_m4
 or exists(select 1 from pg_proc p where p.oid='projectceo_platform._module_signatures(text)'::regprocedure and (p.proowner<>owner_id or p.proacl is distinct from acl)) then raise exception 'R1_PAIR_MODULE_REGISTRY_CHANGED'; end if;
end $module$;
commit;
