-- ProjectCEO RU thin M3: read projection for documentation sheets.
--
-- Additive only, and read-only: v7 wraps v6 exactly the way v6 wrapped v5, so
-- every scope, role and forbidden path already proven for the base projection
-- keeps holding. Nothing here writes, and no private M3 table is exposed —
-- the projection returns the latest revision of each sheet and nothing else.
--
-- Scope rule: documentation sheets are studio-side work. The client approves
-- variants in M2 and never receives the internals of the documentation
-- package; builder and guest never receive M3 material at all. This repeats
-- the rule v6 already applies to m2M3Handoffs rather than inventing a second.

begin;

set local check_function_bodies = on;

create function projectceo_read_api.get_project_workspace_read_v7(
  project_id uuid,
  package_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_base jsonb;
  v_org uuid;
  v_actor uuid;
  v_role text;
  v_sheets jsonb := '[]'::jsonb;
  v_handoffs jsonb := '[]'::jsonb;
begin
  v_base := projectceo_read_api.get_project_workspace_read_v6(project_id, package_id);
  if v_base->'error' is not null and v_base->'error' <> 'null'::jsonb then
    return v_base;
  end if;
  if v_base->'scope' is null or v_base->'scope' = 'null'::jsonb then
    return v_base;
  end if;

  v_org := (v_base#>>'{scope,organizationId}')::uuid;
  v_actor := (v_base#>>'{scope,actorUserId}')::uuid;

  select membership.role into v_role
  from projectceo_foundation.project_memberships membership
  where membership.organization_id = v_org
    and membership.project_id = get_project_workspace_read_v7.project_id
    and membership.user_id = v_actor
    and membership.status = 'active';
  if package_id is not null then
    select membership.role into v_role
    from projectceo_foundation.package_memberships membership
    where membership.organization_id = v_org
      and membership.project_id = get_project_workspace_read_v7.project_id
      and membership.package_id = get_project_workspace_read_v7.package_id
      and membership.user_id = v_actor
      and membership.status = 'active';
  end if;

  if v_role in ('owner_lead', 'architect') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'sheetId', latest.sheet_id,
      'packageId', latest.package_id,
      'roomId', latest.room_id,
      'sheetNumber', latest.sheet_number,
      'title', latest.title,
      'revisionId', latest.revision_id,
      'revisionNo', latest.revision_no,
      'specificationRevisionIds', to_jsonb(latest.specification_revision_ids),
      -- Основание ревизии и её автор: без них ревизия листа в интерфейсе была
      -- бы безымянной, а домен пришлось бы кормить выдуманными значениями.
      'reason', latest.reason,
      'createdByUserId', latest.created_by_user_id,
      'origin', jsonb_build_object(
        'handoffId', latest.handoff_id,
        'handoffRevisionId', latest.handoff_revision_id,
        'handoffContractVersion', latest.handoff_contract_version,
        'approvedM2CommitRevisionId', latest.approved_m2_commit_revision_id,
        'designIntentRevisionId', latest.design_intent_revision_id,
        'layoutDocumentId', latest.layout_document_id,
        'layoutVersionId', latest.layout_version_id,
        'layoutRevisionId', latest.layout_revision_id,
        'semanticHash', latest.semantic_hash
      ),
      'createdAt', latest.created_at
    ) order by latest.sheet_number collate "C", latest.sheet_id collate "C"), '[]'::jsonb)
    into v_sheets
    from (
      select distinct on (sheet.sheet_id) sheet.*
      from projectceo_m3.documentation_sheet_revisions sheet
      where sheet.organization_id = v_org
        and sheet.project_id = get_project_workspace_read_v7.project_id
        and (package_id is null or sheet.package_id = package_id)
      -- Победитель в группе выбирается по номеру ревизии, поэтому сортировка
      -- идентификатора здесь на результат не влияет; детерминированный порядок
      -- по C-коллации задан снаружи, в jsonb_agg.
      order by sheet.sheet_id, sheet.revision_no desc
    ) latest;
  end if;

  -- Тот же handoff, что уже отдаёт v6, но в форме входа модуля документации:
  -- комната и design intent нужны проверке комплектности, а из m2M3Handoffs их
  -- не достать. Ключ отдельный — форма v6 не меняется.
  if v_role in ('owner_lead', 'architect') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'handoffId', handoff.entity_id,
      'revisionId', handoff.revision_id,
      'contractVersion', handoff.payload->>'schemaVersion',
      'packageId', handoff.package_id,
      'roomId', handoff.payload->>'roomId',
      'approvedM2CommitRevisionId', handoff.payload->>'approvedCommitRevisionId',
      'designIntentRevisionId', handoff.payload->>'designIntentRevisionId',
      'layout', jsonb_build_object(
        'documentId', handoff.payload#>>'{chosenVariant,layoutDocumentId}',
        'versionId', handoff.payload#>>'{chosenVariant,layoutVersionId}',
        'revisionId', handoff.payload->>'layoutRevisionId',
        'semanticHash', handoff.payload#>>'{chosenVariant,semanticHash}'
      ),
      'selectionRevisionIds', coalesce(handoff.payload->'selectionRevisionIds', '[]'::jsonb)
    ) order by handoff.entity_id collate "C"), '[]'::jsonb)
    into v_handoffs
    from projectceo_product.m2_workspace_revisions handoff
    where handoff.organization_id = v_org
      and handoff.project_id = get_project_workspace_read_v7.project_id
      and (package_id is null or handoff.package_id = package_id)
      and handoff.entity_kind = 'm2_m3_handoff'
      and handoff.status = 'published';
  end if;

  v_base := jsonb_set(v_base, '{data,m3DocumentationSheets}', v_sheets, true);
  return jsonb_set(v_base, '{data,m3DocumentationHandoffs}', v_handoffs, true);
end
$function$;

alter function projectceo_read_api.get_project_workspace_read_v7(uuid, uuid)
  owner to pi_table_owner;
revoke all on function projectceo_read_api.get_project_workspace_read_v7(uuid, uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
grant execute on function projectceo_read_api.get_project_workspace_read_v7(uuid, uuid)
  to authenticated;

commit;
