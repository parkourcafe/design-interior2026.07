\set ON_ERROR_STOP on

-- Только для DB4/DB5 (одноразовые контейнеры харнесса): вызовы
-- publish_baseline_atomic от authenticated берут ссылки «последняя передача
-- по каждой комнате активного пакета» отсюда. На стенды AP1/AP5 этот файл не
-- применяется — там ссылки выводит сервер приложения из чтения.

grant usage on schema pi_test_fixture to authenticated;

-- Последняя опубликованная передача по каждой комнате каждого активного
-- пакета проекта (DEC-041 §4, миграция 20260928090000).
create or replace function pi_test_fixture.handoff_refs(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'packageId', latest.package_id::text,
      'roomId', latest.room_id,
      'handoffId', latest.entity_id,
      'handoffRevisionId', latest.revision_id
    ) order by latest.package_id, latest.room_id collate "C"), '[]'::jsonb)
  from (
    select distinct on (revision.package_id, revision.payload->>'roomId')
      revision.package_id, revision.payload->>'roomId' as room_id,
      revision.entity_id, revision.revision_id
    from projectceo_product.m2_workspace_revisions revision
    join projectceo_foundation.project_packages package
      on package.organization_id = revision.organization_id
     and package.project_id = revision.project_id
     and package.id = revision.package_id
     and package.status = 'active'
    where revision.project_id = p_project_id
      and revision.entity_kind = 'm2_m3_handoff'
      and revision.status = 'published'
    order by revision.package_id, revision.payload->>'roomId',
      revision.created_at desc, revision.revision_no desc,
      revision.revision_id collate "C" desc
  ) latest
$function$;
revoke all on function pi_test_fixture.handoff_refs(uuid) from public, anon, service_role;
grant execute on function pi_test_fixture.handoff_refs(uuid) to authenticated;
