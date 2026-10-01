-- DEC-041 §4: чтение готовности комнат к baseline (миграция 20260928090000).
--
-- Приложение не повторяет правило свежести: сервер приложения берёт ссылки
-- на передачи и причины недоступности baseline из того же расчёта
-- (_room_handoff_problem), которым их затем проверяет дверь
-- publish_baseline_atomic. Чтение — request-bound: view_project в проекте.
--
-- rooms: по каждому активному пакету — комнаты с утверждённым дизайном и
-- комнаты с опубликованной передачей:
--   {packageId, roomId, applicable, handoffId, handoffRevisionId, problem}
--   applicable — у комнаты есть утверждённый клиентом дизайн;
--   problem — null (передача свежая), M2_HANDOFF_MISSING (передачи нет) или
--   причина из _room_handoff_problem.
-- unboundSelectionRevisionIds: утверждённые selection, которые заморозит
-- baseline, но которых нет ни в одной свежей передаче комнаты — дверь
-- откажет M2_HANDOFF_UNBOUND_SELECTION.

begin;
set local check_function_bodies = on;

create function projectceo_read_api.get_m3_room_handoff_readiness(project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_rooms jsonb;
  v_unbound jsonb;
begin
  select context.organization_id into v_organization_id
  from projectceo_foundation._authorize_project_human(project_id, 'view_project') context;

  with packages as (
    select package.id as package_id
    from projectceo_foundation.project_packages package
    where package.organization_id = v_organization_id
      and package.project_id = project_id
      and package.status = 'active'
  ),
  handoff_rooms as (
    select distinct on (revision.package_id, revision.payload->>'roomId')
      revision.package_id, revision.payload->>'roomId' as room_id, revision
    from projectceo_product.m2_workspace_revisions revision
    join packages on packages.package_id = revision.package_id
    where revision.organization_id = v_organization_id
      and revision.project_id = project_id
      and revision.entity_kind = 'm2_m3_handoff'
      and revision.status = 'published'
      and revision.payload->>'roomId' is not null
    order by revision.package_id, revision.payload->>'roomId',
      revision.created_at desc, revision.revision_no desc,
      revision.revision_id collate "C" desc
  ),
  applicable as (
    select packages.package_id, room.room_id
    from packages
    cross join lateral projectceo_product._package_applicable_rooms(
      v_organization_id, project_id, packages.package_id
    ) room(room_id)
  ),
  rooms as (
    select package_id, room_id from applicable
    union
    select package_id, room_id from handoff_rooms
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'packageId', rooms.package_id::text,
      'roomId', rooms.room_id,
      'applicable', exists (
        select 1 from applicable
        where applicable.package_id = rooms.package_id and applicable.room_id = rooms.room_id
      ),
      'handoffId', (handoff_rooms.revision).entity_id,
      'handoffRevisionId', (handoff_rooms.revision).revision_id,
      'problem', case
        when handoff_rooms.room_id is null then 'M2_HANDOFF_MISSING'
        else projectceo_product._room_handoff_problem(
          v_organization_id, project_id, rooms.package_id, handoff_rooms.revision)
      end
    ) order by rooms.package_id, rooms.room_id collate "C"), '[]'::jsonb)
    into v_rooms
  from rooms
  left join handoff_rooms
    on handoff_rooms.package_id = rooms.package_id
   and handoff_rooms.room_id = rooms.room_id;

  select coalesce(jsonb_agg(winner order by winner collate "C"), '[]'::jsonb)
    into v_unbound
  from projectceo_product._approved_selection_winners(v_organization_id, project_id) winner
  where not exists (
    select 1
    from jsonb_array_elements(v_rooms) room
    join projectceo_product.m2_workspace_revisions revision
      on revision.organization_id = v_organization_id
     and revision.project_id = project_id
     and revision.entity_kind = 'm2_m3_handoff'
     and revision.revision_id = room->>'handoffRevisionId'
    cross join lateral jsonb_array_elements_text(revision.payload->'selectionRevisionIds') selection(revision_id)
    where room->>'problem' is null
      and selection.revision_id = winner
  );

  return jsonb_build_object('rooms', v_rooms, 'unboundSelectionRevisionIds', v_unbound);
end
$function$;

alter function projectceo_read_api.get_m3_room_handoff_readiness(uuid) owner to pi_table_owner;
revoke all on function projectceo_read_api.get_m3_room_handoff_readiness(uuid)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
grant execute on function projectceo_read_api.get_m3_room_handoff_readiness(uuid)
  to authenticated;

commit;
