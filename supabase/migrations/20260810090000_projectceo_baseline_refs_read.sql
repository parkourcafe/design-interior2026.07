-- Состав опубликованного baseline становится читаемым — предпосылка выпуска
-- версии пакета из браузера.
--
-- Зачем. `projectceo_product_api.publish_production_package_version` требует в
-- дескрипторе `exactRevisionRefs`, а для корневого пакета — ВЕСЬ состав
-- baseline: иначе `ROOT_PACKAGE_REQUIRES_FULL_BASELINE`
-- (`20260717101000`, строки 2519–2526). Сервер обязан вывести этот состав сам:
-- по A′ клиент присылает токен, а не список.
--
-- Взять его было неоткуда. `data.latestBaseline` отдавал только идентификаторы
-- и хеш (`20260718124958`, строки 1148–1174), а `projectceo_product.
-- project_baseline_refs` не отдавался ни одному чтению. Ровно поэтому вторая
-- половина гейта 1 (A6 §6.1) упиралась не в дескриптор, а в его отсутствие.
--
-- Почему нельзя вывести состав из одобренных approval package, как это делает
-- сборщик baseline. Потому что это разные множества во времени: baseline —
-- заморозка того, что было одобрено НА МОМЕНТ публикации, а «всё одобренное
-- сейчас» растёт с каждым новым одобрением. Первое же одобрение после baseline
-- сделало бы выведенный состав надмножеством, и RPC отказал бы
-- `PACKAGE_REF_NOT_IN_BASELINE`. Версия пакета обязана строиться от baseline,
-- и значит baseline обязан быть читаемым.
--
-- Прав не добавляет: строки уже видны владельцу проекта через baseline, к
-- которому они принадлежат, а авторизацию делает обёрнутая v7 — v9 работает
-- только когда `scope` уже получен. Новых сущностей наружу не выходит: это
-- идентификаторы ревизий того же проекта, которые чтение и так отдаёт в
-- решениях и выборах.
--
-- Версия новая, а не правка v8: чтения здесь версионированный контракт
-- (v5 → v6 → v7 → v8), и менять поведение отданной версии нельзя. v9
-- оборачивает v8 и добавляет ровно одно поле.

begin;

create function projectceo_read_api.get_project_workspace_read_v9(
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
  v_baseline_id text;
  v_refs jsonb;
begin
  v_base := projectceo_read_api.get_project_workspace_read_v8(project_id, package_id);
  if v_base->'error' is not null and v_base->'error' <> 'null'::jsonb then
    return v_base;
  end if;
  if v_base->'scope' is null or v_base->'scope' = 'null'::jsonb then
    return v_base;
  end if;

  v_baseline_id := v_base #>> '{data,latestBaseline,id}';
  -- Baseline ещё нет — добавлять нечего, и пустой состав выдумывать нельзя:
  -- «нет baseline» и «baseline пуст» для сборщика разные вещи.
  if v_baseline_id is null then
    return v_base;
  end if;

  v_org := (v_base#>>'{scope,organizationId}')::uuid;

  -- Порядок и уникальность — часть контракта: дескриптор пересобирается на
  -- сервере через `_sorted_unique_text_array`, который сортирует по кодовым
  -- точкам и не терпит дублей. Чтение отдаёт ровно тот же порядок, чтобы
  -- сборщику не приходилось угадывать, чей порядок правильный.
  select jsonb_build_object(
    'sources', coalesce(grouped.sources, '[]'::jsonb),
    'requirements', coalesce(grouped.requirements, '[]'::jsonb),
    'assumptions', coalesce(grouped.assumptions, '[]'::jsonb),
    'decisions', coalesce(grouped.decisions, '[]'::jsonb),
    'selections', coalesce(grouped.selections, '[]'::jsonb)
  )
  into v_refs
  from (
    select
      jsonb_agg(ref.revision_id order by ref.revision_id collate "C") filter (
        where ref.target_kind = 'source_revision'
      ) as sources,
      jsonb_agg(ref.revision_id order by ref.revision_id collate "C") filter (
        where ref.target_kind = 'requirement_revision'
      ) as requirements,
      jsonb_agg(ref.revision_id order by ref.revision_id collate "C") filter (
        where ref.target_kind = 'assumption_revision'
      ) as assumptions,
      jsonb_agg(ref.revision_id order by ref.revision_id collate "C") filter (
        where ref.target_kind = 'decision_revision'
      ) as decisions,
      jsonb_agg(ref.revision_id order by ref.revision_id collate "C") filter (
        where ref.target_kind = 'selection_revision'
      ) as selections
    from projectceo_product.project_baseline_refs ref
    where ref.organization_id = v_org
      and ref.project_id = project_id
      and ref.baseline_id = v_baseline_id
  ) grouped;

  return jsonb_set(
    v_base,
    '{data,latestBaseline,exactRevisionRefs}',
    coalesce(v_refs, jsonb_build_object(
      'sources', '[]'::jsonb,
      'requirements', '[]'::jsonb,
      'assumptions', '[]'::jsonb,
      'decisions', '[]'::jsonb,
      'selections', '[]'::jsonb
    ))
  );
end
$function$;

alter function projectceo_read_api.get_project_workspace_read_v9(uuid, uuid)
  owner to pi_table_owner;

revoke all on function projectceo_read_api.get_project_workspace_read_v9(uuid, uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant execute on function projectceo_read_api.get_project_workspace_read_v9(uuid, uuid)
  to authenticated;

-- Обёртка без обёрнутого — это 500 у пользователя. Если v8 переедет или сменит
-- сигнатуру, миграция обязана упасть здесь, а не в браузере.
do $guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'projectceo_read_api'
      and p.proname = 'get_project_workspace_read_v8'
  ) then
    raise exception 'PROJECTCEO_WORKSPACE_READ_V8_MISSING';
  end if;
  if not has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_project_workspace_read_v9(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_WORKSPACE_READ_V9_UNREACHABLE';
  end if;
end
$guard$;

commit;
