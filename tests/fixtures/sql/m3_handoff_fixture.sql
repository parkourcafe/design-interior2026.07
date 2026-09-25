\set ON_ERROR_STOP on

-- Тестовая фикстура для DB4/DB5 (DEC-040 (4), миграция 20260925100000):
-- baseline и выпуск M3 требуют опубликованную передачу M2→M3 по каждому
-- пакету. Позитивные цепочки DB4/DB5 проверяют M3, а не M2: полную дверь
-- publish_m2_m3_handoff (approved commit → client review → layout) доказывает
-- tests/db4/33. Здесь — только засев опубликованной передачи прямой записью
-- от postgres и чтение ссылок «последняя передача по каждому активному
-- пакету» для вызовов publish_baseline_atomic.
--
-- Схема pi_test_fixture существует только в одноразовых базах харнессов.

create schema if not exists pi_test_fixture;
grant usage on schema pi_test_fixture to authenticated;

create or replace function pi_test_fixture.seed_handoff(
  p_project_id uuid,
  p_package_id uuid,
  p_handoff_id text,
  p_design_intent_revision_id text,
  p_selection_revision_ids text[],
  p_actor_user_id uuid
)
returns text
language plpgsql
as $function$
declare
  v_org uuid;
  v_previous record;
  v_revision_no bigint;
  v_revision_id text;
begin
  select organization_id into v_org
  from project_intelligence.project_workflows
  where project_id = p_project_id;
  select revision_id, revision_no into v_previous
  from projectceo_product.m2_workspace_revisions
  where organization_id = v_org and project_id = p_project_id
    and entity_kind = 'm2_m3_handoff' and entity_id = p_handoff_id
  order by revision_no desc
  limit 1;
  v_revision_no := coalesce(v_previous.revision_no, 0) + 1;
  -- UUID-идентификаторы — как у настоящей двери: authenticated-чтение (TS)
  -- строго валидирует форму передачи.
  v_revision_id := extensions.gen_random_uuid()::text;
  insert into projectceo_product.m2_workspace_revisions (
    organization_id, project_id, package_id, entity_kind, entity_id, revision_id,
    revision_no, supersedes_revision_id, status, payload, reason, reason_digest,
    created_by_user_id
  ) values (
    v_org, p_project_id, p_package_id, 'm2_m3_handoff', p_handoff_id, v_revision_id,
    v_revision_no, v_previous.revision_id, 'published',
    jsonb_build_object(
      'approvedCommitId', p_handoff_id || '-commit',
      'approvedCommitRevisionId', extensions.gen_random_uuid()::text,
      'roomId', p_handoff_id || '-room',
      'designIntentRevisionId', p_design_intent_revision_id,
      'chosenVariant', jsonb_build_object(
        'variantId', p_handoff_id || '-variant',
        'layoutDocumentId', p_handoff_id || '-layout',
        'layoutVersionId', p_handoff_id || '-layout-v1',
        'layoutRevisionId', extensions.gen_random_uuid()::text,
        'semanticHash', 'sha256:' || encode(extensions.digest(p_handoff_id, 'sha256'), 'hex')
      ),
      'layoutRevisionId', extensions.gen_random_uuid()::text,
      'selectionRevisionIds', to_jsonb(p_selection_revision_ids),
      'budget', jsonb_build_object(
        'asOf', statement_timestamp(), 'staleAfterDays', 30,
        'staleSelectionRevisionIds', '[]'::jsonb, 'missingPriceSelectionRevisionIds', '[]'::jsonb
      ),
      'schemaVersion', 'archidom.m2-to-m3-handoff/0.1',
      'publishedAt', statement_timestamp()
    ),
    'DB fixture handoff for M3 gate', extensions.digest('DB fixture handoff for M3 gate', 'sha256'),
    p_actor_user_id
  );
  return v_revision_id;
end
$function$;
revoke all on function pi_test_fixture.seed_handoff(uuid, uuid, text, text, text[], uuid)
  from public, anon, authenticated, service_role;

-- Последняя опубликованная передача по каждому активному пакету проекта.
create or replace function pi_test_fixture.handoff_refs(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'packageId', latest.package_id::text,
      'handoffId', latest.entity_id,
      'handoffRevisionId', latest.revision_id
    ) order by latest.package_id), '[]'::jsonb)
  from (
    select distinct on (revision.package_id)
      revision.package_id, revision.entity_id, revision.revision_id
    from projectceo_product.m2_workspace_revisions revision
    join projectceo_foundation.project_packages package
      on package.organization_id = revision.organization_id
     and package.project_id = revision.project_id
     and package.id = revision.package_id
     and package.status = 'active'
    where revision.project_id = p_project_id
      and revision.entity_kind = 'm2_m3_handoff'
      and revision.status = 'published'
      and revision.revision_no = (
        select max(other.revision_no)
        from projectceo_product.m2_workspace_revisions other
        where other.organization_id = revision.organization_id
          and other.project_id = revision.project_id
          and other.entity_kind = 'm2_m3_handoff'
          and other.entity_id = revision.entity_id
      )
    order by revision.package_id, revision.created_at desc, revision.entity_id desc
  ) latest
$function$;
revoke all on function pi_test_fixture.handoff_refs(uuid) from public, anon, service_role;
grant execute on function pi_test_fixture.handoff_refs(uuid) to authenticated;
