\set ON_ERROR_STOP on
-- Synthetic DB3-enrolled project context only. No file intake/approval is created.
-- Single-session behavior; actual revocation overlap is a separate runner check.
begin;
create function pg_temp.expect_pdf_architect_denied(p_project uuid, p_package uuid, p_state text default 'P1103')
returns void language plpgsql as $f$
begin
  perform projectceo_foundation._authorize_pdf_fallback_architect(p_project,p_package);
  raise exception 'PDF_ARCHITECT_UNEXPECTED_ALLOW';
exception when others then
  if sqlstate <> p_state then raise; end if;
end $f$;

do $authority$
declare
  org uuid;
  target_project constant uuid := '41111111-1111-4111-8111-111111111111';
  other_project constant uuid := '42222222-2222-4222-8222-222222222222';
  actor constant uuid := '70000000-0000-4000-8000-000000000070';
  sibling constant uuid := '70000000-0000-4000-8000-000000000071';
  archived_package constant uuid := '70000000-0000-4000-8000-000000000072';
  root_package uuid;
  ctx record;
  role_name text;
  before_count bigint;
begin
  select pw.organization_id into strict org from project_intelligence.project_workflows pw where pw.project_id=target_project;
  select p.id into strict root_package from projectceo_foundation.project_packages p where p.organization_id=org and p.project_id=target_project and p.kind='project_root';
  select count(*) into before_count from projectceo_foundation.external_representation_attestations;
  insert into auth.users(id,email,email_confirmed_at) values(actor,'pdf-architect-fixture@example.test',statement_timestamp());
  insert into project_intelligence.organization_members(organization_id,user_id,role) values(org,actor,'member');
  insert into projectceo_foundation.project_memberships(organization_id,project_id,user_id,role) values(org,target_project,actor,'owner_lead');
  insert into projectceo_foundation.project_member_capabilities(organization_id,project_id,user_id,capability) values(org,target_project,actor,'review_source');
  insert into projectceo_foundation.project_packages(organization_id,project_id,id,stable_key,kind,parent_package_id,name)
    values(org,target_project,sibling,'pdf-authority-sibling','work_package',root_package,'Synthetic authority sibling');
  perform set_config('request.jwt.claim.sub',actor::text,true);

  -- Capability alone and caller JWT role claims cannot impersonate architect.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','architect','user_metadata',jsonb_build_object('role','architect'))::text,true);
  perform pg_temp.expect_pdf_architect_denied(target_project,root_package);
  update projectceo_foundation.project_memberships pm set role='architect' where pm.organization_id=org and pm.project_id=target_project and pm.user_id=actor;
  select * into strict ctx from projectceo_foundation._authorize_pdf_fallback_architect(target_project,root_package);
  if ctx.organization_id<>org or ctx.actor_user_id<>actor or ctx.actor_id<>actor::text or ctx.project_wide is distinct from true then raise exception 'PDF_ARCHITECT_CONTEXT_MISMATCH'; end if;

  update projectceo_foundation.project_memberships pm set status='inactive' where pm.organization_id=org and pm.project_id=target_project and pm.user_id=actor;
  perform pg_temp.expect_pdf_architect_denied(target_project,root_package);
  update projectceo_foundation.project_memberships pm set status='active',role='owner_lead' where pm.organization_id=org and pm.project_id=target_project and pm.user_id=actor;

  -- Project owner plus architect in an unrelated package is insufficient.
  insert into projectceo_foundation.package_memberships(organization_id,project_id,package_id,user_id,role) values(org,target_project,sibling,actor,'architect');
  perform pg_temp.expect_pdf_architect_denied(target_project,root_package);
  insert into projectceo_foundation.package_memberships(organization_id,project_id,package_id,user_id,role) values(org,target_project,root_package,actor,'architect');
  select * into strict ctx from projectceo_foundation._authorize_pdf_fallback_architect(target_project,root_package);
  if ctx.project_wide is distinct from false then raise exception 'PDF_MIXED_OWNER_ARCHITECT_SCOPE_ESCALATION'; end if;
  update projectceo_foundation.package_memberships pm set status='inactive' where pm.organization_id=org and pm.project_id=target_project and pm.package_id=root_package and pm.user_id=actor;
  perform pg_temp.expect_pdf_architect_denied(target_project,root_package);
  update projectceo_foundation.package_memberships pm set status='active',role='builder' where pm.organization_id=org and pm.project_id=target_project and pm.package_id=root_package and pm.user_id=actor;
  perform pg_temp.expect_pdf_architect_denied(target_project,root_package);
  update projectceo_foundation.package_memberships pm set role='architect' where pm.organization_id=org and pm.project_id=target_project and pm.package_id=root_package and pm.user_id=actor;

  delete from projectceo_foundation.project_member_capabilities pc where pc.organization_id=org and pc.project_id=target_project and pc.user_id=actor and pc.capability='review_source';
  perform pg_temp.expect_pdf_architect_denied(target_project,root_package);
  insert into projectceo_foundation.package_member_capabilities(organization_id,project_id,package_id,user_id,capability) values(org,target_project,root_package,actor,'review_source');
  select * into strict ctx from projectceo_foundation._authorize_pdf_fallback_architect(target_project,root_package);
  if ctx.project_wide is distinct from false then raise exception 'PDF_ARCHITECT_PACKAGE_ESCALATION'; end if;
  perform pg_temp.expect_pdf_architect_denied(target_project,sibling);
  perform pg_temp.expect_pdf_architect_denied(other_project,root_package);

  update project_intelligence.organization_members om set status='inactive' where om.organization_id=org and om.user_id=actor;
  perform pg_temp.expect_pdf_architect_denied(target_project,root_package);
  update project_intelligence.organization_members om set status='active' where om.organization_id=org and om.user_id=actor;
  -- Package rows are append-only: construct a separate archived fixture,
  -- never mutate the active package or suppress its guard.
  insert into projectceo_foundation.project_packages(organization_id,project_id,id,stable_key,kind,parent_package_id,name,status)
    values(org,target_project,archived_package,'pdf-authority-archived','work_package',root_package,'Synthetic archived package','archived');
  insert into projectceo_foundation.package_memberships(organization_id,project_id,package_id,user_id,role)
    values(org,target_project,archived_package,actor,'architect');
  insert into projectceo_foundation.package_member_capabilities(organization_id,project_id,package_id,user_id,capability)
    values(org,target_project,archived_package,actor,'review_source');
  perform pg_temp.expect_pdf_architect_denied(target_project,archived_package);
  update project_intelligence.organizations o set status='suspended' where o.id=org;
  perform pg_temp.expect_pdf_architect_denied(target_project,root_package);
  update project_intelligence.organizations o set status='active' where o.id=org;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  perform pg_temp.expect_pdf_architect_denied(target_project,root_package,'P1101');

  foreach role_name in array array['anon','authenticated','service_role','pi_human_executor','pi_worker_executor'] loop
    if has_function_privilege(role_name,'projectceo_foundation._authorize_pdf_fallback_architect(uuid,uuid)','EXECUTE') then raise exception 'PDF_ARCHITECT_RUNTIME_EXECUTE'; end if;
  end loop;
  if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='projectceo_foundation._authorize_pdf_fallback_architect(uuid,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'PDF_ARCHITECT_PUBLIC_EXECUTE'; end if;
  if (select count(*) from projectceo_foundation.external_representation_attestations)<>before_count then raise exception 'PDF_AUTHORIZATION_CREATED_ATTESTATION'; end if;
end $authority$;
rollback;
select 'R1_PDF_ARCHITECT_AUTHORITY_BEHAVIOR_OK' as result;
