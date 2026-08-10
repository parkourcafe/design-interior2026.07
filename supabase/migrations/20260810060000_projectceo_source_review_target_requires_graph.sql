-- Ревизия для ревью не предлагается, пока её нет в графе утверждений.
--
-- Что нашёл гейт AP5. Источник, заведённый из браузера, попадает в инвентарь
-- (`projectceo_foundation.source_inventory_records`), но узлы и ревизии графа
-- создаёт воркерный `ingest_source_graph` — отдельная операция, человеку
-- недоступная. Чтение при этом отдавало
-- `reviewTargetRevisionId = inventory.source_revision_id` безусловно
-- (`20260718124958`), а `reviewStatus` считало `pending` просто потому, что
-- решения ещё нет.
--
-- То есть поверхность предлагала отрецензировать ревизию, которой в графе не
-- существует. `project_intelligence_api.review_claim` отвечал на это ровно так,
-- как должен, — `P1004 REVISION_STALE` с `currentRevisionId: null`, — и
-- пользователь получал 409 на кнопку, которая выглядела рабочей.
--
-- Раньше этого не было видно: вызов не доходил до RPC вовсе и падал 500 на
-- границе схем (починено дверью `20260810050000`). Дверь убрала первый дефект и
-- обнажила второй — они складывались.
--
-- Здесь чинится причина, а не симптом: `reviewTargetRevisionId` становится
-- non-null только тогда, когда ревизия действительно есть в
-- `project_intelligence.graph_node_revisions`. Тогда `live-read-port` сам
-- отдаёт `prerequisite_missing` (воркерный ingest не отработал), а команда,
-- если её всё же послать, отказывает `not_found` до сети.
--
-- Версия новая, а не правка v7: чтения здесь — версионированный контракт
-- (v5 → v6 → v7), и менять поведение уже отданной версии значит менять землю
-- под тем, кто на неё сослался. v8 оборачивает v7 и сужает ровно одно поле.

begin;

create function projectceo_read_api.get_project_workspace_read_v8(
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
  v_sources jsonb;
begin
  v_base := projectceo_read_api.get_project_workspace_read_v7(project_id, package_id);
  if v_base->'error' is not null and v_base->'error' <> 'null'::jsonb then
    return v_base;
  end if;
  if v_base->'scope' is null or v_base->'scope' = 'null'::jsonb then
    return v_base;
  end if;

  v_org := (v_base#>>'{scope,organizationId}')::uuid;

  -- Порядок источников — часть контракта чтения (инвентарь сортируется по
  -- floor/zone/discipline/name), поэтому пересборка идёт с ordinality.
  select coalesce(jsonb_agg(patched order by ord), '[]'::jsonb)
  into v_sources
  from jsonb_array_elements(
    coalesce(v_base #> '{data,sources}', '[]'::jsonb)
  ) with ordinality as entry(source, ord)
  cross join lateral (
    select case
      when entry.source ->> 'reviewTargetRevisionId' is null then entry.source
      when exists (
        select 1
        from project_intelligence.graph_node_revisions revision
        where revision.organization_id = v_org
          and revision.project_id = project_id
          and revision.revision_id = entry.source ->> 'reviewTargetRevisionId'
      ) then entry.source
      -- Ревизии в графе нет: рецензировать нечего, и обещать нечего.
      else jsonb_set(entry.source, '{reviewTargetRevisionId}', 'null'::jsonb)
    end as patched
  ) patched_source;

  return jsonb_set(v_base, '{data,sources}', v_sources);
end
$function$;

alter function projectceo_read_api.get_project_workspace_read_v8(uuid, uuid)
  owner to pi_table_owner;

revoke all on function projectceo_read_api.get_project_workspace_read_v8(uuid, uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant execute on function projectceo_read_api.get_project_workspace_read_v8(uuid, uuid)
  to authenticated;

-- Обёртка без обёрнутого — это 500 у пользователя. Если v7 переедет или сменит
-- сигнатуру, миграция обязана упасть здесь, а не в браузере.
do $guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'projectceo_read_api'
      and p.proname = 'get_project_workspace_read_v7'
  ) then
    raise exception 'PROJECTCEO_WORKSPACE_READ_V7_MISSING';
  end if;
  if not has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_project_workspace_read_v8(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_WORKSPACE_READ_V8_UNREACHABLE';
  end if;
end
$guard$;

commit;
