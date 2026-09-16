-- Private authorization primitive only: no attestation, grant or runtime RPC.
begin;

create function projectceo_foundation._authorize_pdf_fallback_architect(
  p_project_id uuid,
  p_package_id uuid
)
returns table (
  organization_id uuid,
  actor_user_id uuid,
  actor_id text,
  project_wide boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  ctx record;
begin
  select * into strict ctx from projectceo_foundation._authorize_package_human(
    p_project_id, p_package_id, 'review_source'
  );

  -- Same order as external intake review. Lock rows before inspecting role/status;
  -- FOR SHARE also excludes non-key role/status updates, not just deletion.
  perform 1 from project_intelligence.project_workflows locked
    where locked.organization_id = ctx.organization_id and locked.project_id = p_project_id for update;
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
      and locked.user_id = ctx.actor_user_id and locked.capability = 'review_source' for share;
  perform 1 from projectceo_foundation.package_memberships locked
    where locked.organization_id = ctx.organization_id and locked.project_id = p_project_id
      and locked.package_id = p_package_id and locked.user_id = ctx.actor_user_id for share;
  perform 1 from projectceo_foundation.package_member_capabilities locked
    where locked.organization_id = ctx.organization_id and locked.project_id = p_project_id
      and locked.package_id = p_package_id and locked.user_id = ctx.actor_user_id
      and locked.capability = 'review_source' for share;

  -- Re-evaluate after any lock wait, before a future caller's replay or write.
  select * into strict ctx from projectceo_foundation._authorize_package_human(
    p_project_id, p_package_id, 'review_source'
  );
  if not (
    exists (
      select 1 from projectceo_foundation.project_memberships pm
      where pm.organization_id = ctx.organization_id and pm.project_id = p_project_id
        and pm.user_id = ctx.actor_user_id and pm.status = 'active' and pm.role = 'architect'
    ) or exists (
      select 1 from projectceo_foundation.package_memberships pm
      where pm.organization_id = ctx.organization_id and pm.project_id = p_project_id
        and pm.package_id = p_package_id and pm.user_id = ctx.actor_user_id
        and pm.status = 'active' and pm.role = 'architect'
    )
  ) then
    perform projectceo_foundation._raise(
      'P1103', 'forbidden', '{"reason":"PDF_FALLBACK_ARCHITECT_REQUIRED"}'::jsonb
    );
  end if;

  organization_id := ctx.organization_id;
  actor_user_id := ctx.actor_user_id;
  actor_id := ctx.actor_id;
  -- Capability scope and architect scope must both cover the whole project.
  project_wide := ctx.project_wide and exists (
    select 1 from projectceo_foundation.project_memberships pm
    where pm.organization_id = ctx.organization_id and pm.project_id = p_project_id
      and pm.user_id = ctx.actor_user_id and pm.status = 'active' and pm.role = 'architect'
  );
  return next;
end
$function$;

alter function projectceo_foundation._authorize_pdf_fallback_architect(uuid, uuid)
  owner to pi_table_owner;
revoke all on function projectceo_foundation._authorize_pdf_fallback_architect(uuid, uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

commit;
