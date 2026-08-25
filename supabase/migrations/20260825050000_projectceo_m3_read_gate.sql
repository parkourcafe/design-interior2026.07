-- Гейт читающих RPC по состоянию модуля M3 (M3 backlog #2): при выключенном
-- модуле прямой Data API не отдаёт source/sheet данные.
--
-- НАХОДКА, РАДИ КОТОРОЙ МИГРАЦИЯ. Guardrail `20260811010000` закрыл ПИШУЩИЕ
-- двери M3 отзывом прав. Читающие так закрыть нельзя: workspace-read общий с
-- M1/M2, отзыв уронил бы весь рабочий стол. Пока гейта не было, любая
-- аутентифицированная сессия читала инвентарь источников и листы документации
-- через PostgREST даже там, где модуль выключен, — флаг приложения этого
-- вызова не видит.
--
-- ЧТО ГЕЙТИТСЯ. Секции, принадлежащие модулю M3:
--   * базовое чтение: `sources` (инвентарь) и `sourceStats` (агрегаты
--     инвентаря — счётчики тоже данные);
--   * v7: `m3DocumentationSheets` / `m3DocumentationHandoffs` (листы и вход
--     модуля документации).
-- Всё остальное (решения, выборы, согласования, baseline) — поверхность
-- M1/M2 и продуктового мозга, модулем M3 не закрывается.
--
-- ПРИЗНАК «МОДУЛЬ ОТКРЫТ» — `projectceo_platform.m3_read_gate_open()`
-- (`20260825020000`): фактический грант M3-only двери. Одна физическая
-- граница на оба механизма открытия — production-выключатель
-- (`open_module_production`) и enable-скрипт одноразовой среды.
--
-- ПОЧЕМУ БАЗОВОЕ ЧТЕНИЕ ПРАВИТСЯ ХИРУРГИЕЙ pg_get_functiondef, А НЕ КОПИЕЙ.
-- Тело `get_project_workspace_read` в базе — НЕ текст миграции
-- `20260718124958`: `20260801120000` динамически переписала в нём обращения к
-- managed auth. Копия исходного текста вернула бы `auth.uid()` и уронила гейт
-- `DB4_MANAGED_AUTH_REFERENCE_REMAINS`. Поэтому — тот же приём, что у той
-- миграции: взять текущее определение, вставить гейт по уникальному якорю,
-- проверить, что вставка случилась ровно один раз.
--
-- «Версию не меняем» здесь не действует: backlog #2 — санкционированное
-- сквозное изменение поведения ВСЕХ версий («нужен gate внутри RPC»), форма
-- ответа при этом не меняется — секции становятся пустыми, а не исчезают.

begin;

-- 1. Базовое чтение: sources → [], sourceStats → нули при закрытом модуле.
do $base_read_surgery$
declare
  v_oid oid;
  v_definition text;
  v_anchor text := '  ) into v_data;';
  v_replacement text;
  v_count integer;
begin
  select p.oid into v_oid
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_read_api'
    and p.proname = 'get_project_workspace_read'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'project_id uuid, package_id uuid';
  if v_oid is null then
    raise exception 'PROJECTCEO_M3_READ_GATE_BASE_MISSING';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);

  -- Подсчёт вхождений строкой, не regexp: в якоре есть метасимвол ')'.
  v_count := (
    length(v_definition) - length(replace(v_definition, v_anchor, ''))
  ) / length(v_anchor);
  if v_count <> 1 then
    raise exception
      'PROJECTCEO_M3_READ_GATE_ANCHOR_COUNT:%', v_count;
  end if;

  v_replacement := v_anchor || '

  -- Гейт модуля M3 (backlog #2, миграция 20260825050000): при выключенном
  -- модуле инвентарь источников не отдаётся — ни строками, ни счётчиками.
  if not projectceo_platform.m3_read_gate_open() then
    v_data := v_data || jsonb_build_object(
      ''sources'', ''[]''::jsonb,
      ''sourceStats'', jsonb_build_object(
        ''duplicateGroups'', 0,
        ''materializedRecords'', 0,
        ''physicalRecords'', 0,
        ''placeholders'', 0,
        ''quarantinedGroups'', 0,
        ''reviewQueue'', 0,
        ''uniqueBlobs'', 0
      )
    );
  end if;';

  v_definition := replace(v_definition, v_anchor, v_replacement);
  execute v_definition;
end
$base_read_surgery$;

-- 2. v7: листы и входы модуля документации не отдаются при закрытом модуле.
-- Здесь полная замена тела (оно короткое и не трогалось auth-rewrite'ом):
-- гейт стоит сразу после базового чтения, ветки ролей ниже не достигаются.
create or replace function projectceo_read_api.get_project_workspace_read_v7(
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

  -- Гейт модуля M3 (backlog #2, миграция 20260825050000): при выключенном
  -- модуле ключи листов не ставятся вовсе — то же утверждение «поверхность
  -- не отдаётся», которым v7 отвечает ролям без листов.
  if not projectceo_platform.m3_read_gate_open() then
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
    from (
      -- Переопубликованный handoff остаётся published во всех своих ревизиях
      -- (леджер append-only), но входом модуля является только последняя:
      -- лист, заведённый от вытесненной ревизии, указывал бы на утверждение,
      -- которого больше нет.
      select distinct on (handoff.entity_id) handoff.*
      from projectceo_product.m2_workspace_revisions handoff
      where handoff.organization_id = v_org
        and handoff.project_id = get_project_workspace_read_v7.project_id
        and (package_id is null or handoff.package_id = package_id)
        and handoff.entity_kind = 'm2_m3_handoff'
        and handoff.status = 'published'
      order by handoff.entity_id, handoff.revision_no desc
    ) handoff;
  end if;

  -- Ключи ставятся только тем, кто получает поверхность. Отсутствие ключей —
  -- это утверждение «роль не получает листы», и порт превращает его в null;
  -- пустой массив значил бы «получает, но пусто» — другое утверждение.
  if v_role not in ('owner_lead', 'architect') then
    return v_base;
  end if;
  v_base := jsonb_set(v_base, '{data,m3DocumentationSheets}', v_sheets, true);
  return jsonb_set(v_base, '{data,m3DocumentationHandoffs}', v_handoffs, true);
end
$function$;

-- Guard: гейт реально вшит в оба места, гранты не сдвинулись.
do $guard$
declare
  v_base_def text;
  v_v7_def text;
begin
  select pg_catalog.pg_get_functiondef(p.oid) into v_base_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_read_api'
    and p.proname = 'get_project_workspace_read';
  if v_base_def not like '%m3_read_gate_open%' then
    raise exception 'PROJECTCEO_M3_READ_GATE_BASE_NOT_INJECTED';
  end if;
  if v_base_def ~ 'auth\.(uid\s*\(|jwt\s*\(|users)' then
    raise exception 'PROJECTCEO_M3_READ_GATE_REINTRODUCED_MANAGED_AUTH';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid) into v_v7_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_read_api'
    and p.proname = 'get_project_workspace_read_v7';
  if v_v7_def not like '%m3_read_gate_open%' then
    raise exception 'PROJECTCEO_M3_READ_GATE_V7_NOT_INJECTED';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_project_workspace_read_v7(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_M3_READ_GATE_V7_LOST_GRANT';
  end if;
end
$guard$;

commit;
