\set ON_ERROR_STOP on

-- Только для DB4/DB5 (одноразовые контейнеры харнесса): вызовы
-- publish_baseline_atomic от authenticated берут ссылки «последняя передача
-- по каждому активному пакету» отсюда. На стенды AP1/AP5 этот файл не
-- применяется — там ссылки выводит сервер приложения из чтения.

grant usage on schema pi_test_fixture to authenticated;

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
