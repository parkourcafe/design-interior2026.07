-- ТЗ 08.10.2026, FIX-03, доработка 11.10.2026 (решение владельца, п. 3):
-- уточнения клиента (passport.clarifications) выдаются сервером только
-- законным читателям, проверка — при каждом чтении, механизм — полномочия
-- одобрения паспорта DEC-041 §3 (projectceo_platform._passport_approval_authority):
--   * владелец проекта / дизайнер студии — активное членство owner_lead
--     (в M1 дизайнер зарегистрирован организацией как legacy_designer_id и
--     входит в проект как owner_lead, поэтому его доступ сохраняется);
--   * архитектор — только при действующем праве approve_passport, выданном
--     владельцем (grant/revoke_passport_approval); после отзыва — не выдаются.
-- Всем остальным, кто проходит гейт RPC, паспорт отдаётся без ключа
-- clarifications. Контакты и бюджет этой миграцией не меняются (отдельная
-- находка). Изменение аддитивное: тело функции заменено, сигнатура, владелец,
-- SECURITY DEFINER и права прежние.

begin;

create or replace function projectceo_read_api.get_m1_legacy_project_read(
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
  v_clarifications_allowed boolean;
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

  -- Уточнения клиента: полномочие DEC-041 §3, вычисленное для этого чтения.
  -- Без права функция полномочий возвращает NULL; флаг должен быть строго
  -- false, а не null, чтобы клиент не мог прочитать «неизвестно» как «можно».
  v_clarifications_allowed := coalesce(
    projectceo_platform._passport_approval_authority(
      v_context.organization_id, project_id, v_context.actor_user_id
    ) in ('owner', 'delegated_architect'),
    false
  );

  select jsonb_build_object(
    'projectId', r.project_id,
    'revisionNo', r.revision_no,
    'passport', case
      when v_clarifications_allowed then r.passport
      else r.passport - 'clarifications'
    end,
    'llmOk', r.llm_ok,
    'createdAt', r.created_at,
    'clarificationsVisible', v_clarifications_allowed
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
grant execute on function projectceo_read_api.get_m1_legacy_project_read(uuid)
  to authenticated;

commit;
