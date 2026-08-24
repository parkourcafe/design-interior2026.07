-- Чтение называет устаревшие одобрения — SQL-половина M4 backlog #5.
--
-- ДЕФЕКТ (найден 11.08 вместе с правкой «одна ревизия на сущность», commit
-- 7bf00fd; задокументирован в `baseline-composition.ts:41-47`): если решение
-- пересмотрели, а новую ревизию не одобрили, последняя одобренная ревизия
-- устарела — сборщик baseline возьмёт её, база честно откажет
-- (`BASELINE_REVISION_NOT_IN_GRAPH_VERSION`), но ПОВЕРХНОСТЬ ПРОДОЛЖИТ
-- ПРЕДЛАГАТЬ публикацию: сборщик не знает текущих ревизий графа. Нарушение
-- A6 §4.2.5 «поверхность не обещает того, чего сервер не выполнит».
--
-- ЛЕЧЕНИЕ ПО BACKLOG — «сверка состава с текущими ревизиями графа в чтении».
-- v10 оборачивает v9 (конвенция версий чтения, `20260810090000`) и добавляет
-- ровно одно поле: `data.approvalSupersededEntities` — сущности, чья
-- ПОБЕДИВШАЯ одобренная ревизия (правило «одна ревизия на сущность»:
-- последний по created_at одобривший пакет, тай-брейк по id — зеркало
-- `baseline-composition.ts:145-190`) уже не текущая в графе, и текущая при
-- этом не переодобрена. Непустой список — сигнал поверхности отдавать
-- `publish_baseline` как `prerequisite_missing`.
--
-- ГРАНИЦА ЭТОЙ МИГРАЦИИ. Потребление поля в `live-read-port.ts`
-- (operationStates: publish_baseline → prerequisite_missing при непустом
-- списке) — зона Фазы 2 до мерджа её PR-3: правка там — ЗАПРОС КООРДИНАЦИИ,
-- а не часть этого PR. Для requirement/assumption сущностей это поле —
-- единственный источник: их текущих ревизий проекция не отдаёт вовсе.

begin;

set local check_function_bodies = on;

create function projectceo_read_api.get_project_workspace_read_v10(
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
  v_superseded jsonb;
begin
  v_base := projectceo_read_api.get_project_workspace_read_v9(project_id, package_id);
  if v_base->'error' is not null and v_base->'error' <> 'null'::jsonb then
    return v_base;
  end if;
  if v_base->'scope' is null or v_base->'scope' = 'null'::jsonb then
    return v_base;
  end if;

  v_org := (v_base#>>'{scope,organizationId}')::uuid;

  with approved_items as (
    -- Позиции пакетов, чей ПОСЛЕДНИЙ статус — approved; область пакета
    -- сужается тем же параметром, что и всё чтение.
    select
      item.target_kind,
      item.entity_id,
      item.revision_id,
      ap.created_at,
      ap.approval_package_id
    from projectceo_product.approval_package_items item
    join projectceo_product.approval_packages ap
      on ap.organization_id = item.organization_id
     and ap.project_id = item.project_id
     and ap.approval_package_id = item.approval_package_id
    join lateral (
      select event.to_status
      from projectceo_product.approval_package_events event
      where event.organization_id = ap.organization_id
        and event.project_id = ap.project_id
        and event.approval_package_id = ap.approval_package_id
      order by event.sequence_no desc
      limit 1
    ) latest on latest.to_status = 'approved'
    where item.organization_id = v_org
      and item.project_id = project_id
      and (package_id is null or ap.package_id = package_id)
  ),
  winners as (
    -- Одна ревизия на сущность: побеждает последний одобривший пакет.
    select distinct on (approved.target_kind, approved.entity_id)
      approved.target_kind,
      approved.entity_id,
      approved.revision_id
    from approved_items approved
    order by
      approved.target_kind,
      approved.entity_id,
      approved.created_at desc,
      approved.approval_package_id collate "C" desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'targetKind', stale.target_kind,
    'entityId', stale.entity_id,
    'approvedRevisionId', stale.revision_id,
    'currentRevisionId', stale.current_revision_id
  ) order by
      stale.target_kind collate "C",
      stale.entity_id collate "C"
  ), '[]'::jsonb)
  into v_superseded
  from (
    select
      winner.target_kind,
      winner.entity_id,
      winner.revision_id,
      node.current_revision_id
    from winners winner
    join project_intelligence.graph_nodes node
      on node.organization_id = v_org
     and node.project_id = project_id
     and node.node_id = winner.entity_id
    where node.current_revision_id is distinct from winner.revision_id
      -- Текущая ревизия не переодобрена никаким approved-пакетом.
      and not exists (
        select 1
        from approved_items current_approval
        where current_approval.target_kind = winner.target_kind
          and current_approval.entity_id = winner.entity_id
          and current_approval.revision_id = node.current_revision_id
      )
  ) stale;

  return jsonb_set(
    v_base,
    '{data,approvalSupersededEntities}',
    v_superseded,
    true
  );
end
$function$;

alter function projectceo_read_api.get_project_workspace_read_v10(uuid, uuid)
  owner to pi_table_owner;
revoke all on function projectceo_read_api.get_project_workspace_read_v10(uuid, uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
grant execute on function projectceo_read_api.get_project_workspace_read_v10(uuid, uuid)
  to authenticated;

-- Обёртка без обёрнутого — 500 у пользователя (правило `20260810090000`).
do $guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'projectceo_read_api'
      and p.proname = 'get_project_workspace_read_v9'
  ) then
    raise exception 'PROJECTCEO_WORKSPACE_READ_V9_MISSING';
  end if;
  if not has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_project_workspace_read_v10(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_WORKSPACE_READ_V10_UNREACHABLE';
  end if;
end
$guard$;

commit;
