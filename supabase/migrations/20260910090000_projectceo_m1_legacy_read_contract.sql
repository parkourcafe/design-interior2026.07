-- S-MIG #6 / DB4-59: request-bound read of the legacy M1 passport and
-- contract status.  The canonical foundation authorizer remains the only
-- source of actor, organization and project scope.
begin;

create function projectceo_read_api.get_m1_legacy_project_read(
  project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_role text;
  v_state_revision bigint;
  v_passport jsonb;
  v_contract jsonb;
begin
  select *
    into v_context
  from projectceo_foundation._authorize_project_human(
    project_id,
    'view_project'
  );

  select pm.role
    into v_role
  from projectceo_foundation.project_memberships pm
  where pm.organization_id = v_context.organization_id
    and pm.project_id = project_id
    and pm.user_id = v_context.actor_user_id
    and pm.status = 'active';

  if v_role is null or v_role not in ('owner_lead', 'architect') then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"M1_LEGACY_READ_ROLE_REQUIRED"}'::jsonb
    );
  end if;

  if not exists (
    select 1
    from project_intelligence.project_workflows pw
    join project_intelligence.organizations o
      on o.id = pw.organization_id
     and o.legacy_designer_id = (
       select p.designer_id from public.projects p where p.id = project_id
     )
    where pw.organization_id = v_context.organization_id
      and pw.project_id = project_id
  ) then
    perform projectceo_foundation._raise(
      'P1103',
      'forbidden',
      '{"reason":"M1_LEGACY_PROJECT_BINDING_MISMATCH"}'::jsonb
    );
  end if;

  select pw.state_revision
    into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id;

  if v_state_revision is null then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"reason":"PROJECT_WORKFLOW_NOT_FOUND"}'::jsonb
    );
  end if;

  select jsonb_build_object(
    'projectId', r.project_id,
    'revisionNo', r.revision_no,
    'passport', r.passport,
    'llmOk', r.llm_ok,
    'createdAt', r.created_at
  )
    into v_passport
  from public.project_passport_revisions r
  where r.project_id = project_id
  order by r.revision_no desc
  limit 1;

  select jsonb_build_object(
    'documentId', d.id,
    'status', d.status,
    'createdAt', d.created_at,
    'statusUpdatedAt', d.status_updated_at
  )
    into v_contract
  from public.contract_documents d
  where d.project_id = project_id
  order by d.created_at desc, d.id desc
  limit 1;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-m1-legacy-read/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'scope', jsonb_build_object(
      'accessScope', 'project',
      'actorUserId', v_context.actor_user_id,
      'organizationId', v_context.organization_id,
      'packageId', null,
      'projectId', project_id
    ),
    'stateRevision', v_state_revision,
    'data', jsonb_build_object(
      'passportRevision', v_passport,
      'contractDocument', v_contract
    ),
    'error', null::jsonb
  );
end
$function$;

alter function projectceo_read_api.get_m1_legacy_project_read(uuid)
  owner to pi_table_owner;
revoke all on function projectceo_read_api.get_m1_legacy_project_read(uuid)
  from public, anon, authenticated, service_role, pi_human_executor,
       pi_worker_executor;
grant usage on schema projectceo_read_api to authenticated;
-- The SECURITY DEFINER owner needs a narrow table grant; Data API roles remain
-- governed exclusively by the existing RLS/ACL contract.
grant select on table public.contract_documents to pi_table_owner;
create policy contract_documents_internal_owner
on public.contract_documents
for all
to pi_table_owner
using (true)
with check (true);
grant execute on function projectceo_read_api.get_m1_legacy_project_read(uuid)
  to authenticated;

commit;
