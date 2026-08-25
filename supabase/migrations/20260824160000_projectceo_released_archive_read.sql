-- Read-only проекция released archive (M3 backlog #4).
--
-- ЗАЧЕМ ОТДЕЛЬНАЯ RPC. Полный `get_project_workspace_read_v9` архивом не
-- является: он отдаёт рабочий стол — черновики, очереди ревью, снапшоты
-- согласований. Поверхности Project Archive нужен срез ровно того, что
-- ВЫПУЩЕНО: версии производственных пакетов, их артефакты и листы
-- документации пакетов, у которых есть хотя бы один выпуск. Продуктовая
-- основа — §1.7 решения DEC-026/027.
--
-- DTO-САНИТИЗАЦИЯ. Наружу не выходят: имена приватных таблиц, исходные имена
-- файлов, подписанные URL, `logical_content` артефактов (это содержимое
-- выпуска, его выдаёт контур выдачи/подтверждения, а не листинг архива),
-- `semantic_content` версий (внутренности дескриптора). Хеши отдаются в
-- каноничной форме `sha256:<hex>` — они уже публичны через выдачу.
--
-- ДОСТУП. По capability чтения проекта (`view_project`,
-- `_authorize_project_human`): чужая организация и не-участник получают
-- P1103 тем же путём, что все чтения. Листы документации — студийная
-- внутренность: их видят только `owner_lead`/`architect`, ровно по правилу,
-- которое v7 уже применяет к m3DocumentationSheets; версии и артефакты видит
-- любой участник проекта — это и есть выпущенный результат.
--
-- ГЕЙТ МОДУЛЯ. При выключенном M3 проекция отвечает `module_disabled`
-- (P1113). Признак «модуль включён в этой среде» — фактический грант
-- M3-only двери `register_documentation_sheet` роли `authenticated`:
-- это та самая вторая граница выключателя. Её выставляют ровно два
-- механизма — `enable-m3-publication.sql` в одноразовой среде и
-- `projectceo_platform.open_module_production('m3', ...)` в production
-- (`20260824150000`) — и оба же её снимают. Журнал выключателя здесь
-- сознательно НЕ первичен: он существует только в средах, где модуль
-- открывали решением владельца, а одноразовые среды открываются скриптом,
-- который журнала не касается. Право — один физический факт на обе среды.

begin;

set local check_function_bodies = on;

-- Признак «читающая поверхность M3 открыта» — одним определением на все
-- будущие читающие гейты, а не копией выражения в каждом.
create function projectceo_platform.m3_read_gate_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m3_api.register_documentation_sheet(uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text)',
    'EXECUTE'
  );
$function$;

alter function projectceo_platform.m3_read_gate_open() owner to pi_table_owner;
revoke all on function projectceo_platform.m3_read_gate_open()
  from public, anon, authenticated, service_role;

create function projectceo_read_api.get_released_archive_read_v1(
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
  v_org uuid;
  v_actor uuid;
  v_role text;
  v_versions jsonb;
  v_artifacts jsonb;
  v_sheets jsonb;
  v_data jsonb;
begin
  select context.organization_id, context.actor_user_id
    into v_org, v_actor
  from projectceo_foundation._authorize_project_human(
    project_id,
    'view_project'
  ) context;

  if not projectceo_platform.m3_read_gate_open() then
    perform projectceo_foundation._raise(
      'P1113',
      'module_disabled',
      '{"module":"m3"}'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'productionPackageVersionId', version.production_package_version_id,
    'packageId', version.package_id,
    'baselineId', version.baseline_id,
    'versionNo', version.version_no,
    'previousVersionId', version.previous_version_id,
    'semanticHash', 'sha256:' || encode(version.semantic_digest, 'hex'),
    'publishedByUserId', version.published_by_user_id,
    'publishedAt', version.published_at
  ) order by
      version.package_id::text collate "C",
      version.version_no
  ), '[]'::jsonb)
  into v_versions
  from projectceo_product.production_package_versions version
  where version.organization_id = v_org
    and version.project_id = project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'artifactId', artifact.artifact_id,
    'packageId', artifact.package_id,
    'productionPackageVersionId', artifact.production_package_version_id,
    'format', artifact.format,
    'semanticHash', 'sha256:' || encode(artifact.semantic_digest, 'hex'),
    'createdByType', artifact.created_by_type,
    'createdAt', artifact.created_at
  ) order by
      artifact.package_id::text collate "C",
      artifact.production_package_version_id collate "C",
      artifact.artifact_id collate "C"
  ), '[]'::jsonb)
  into v_artifacts
  from projectceo_product.release_artifacts artifact
  where artifact.organization_id = v_org
    and artifact.project_id = project_id;

  v_data := jsonb_build_object(
    'versions', v_versions,
    'artifacts', v_artifacts
  );

  -- Листы — только студийным ролям и только для пакетов, у которых есть
  -- хотя бы один выпуск: архив описывает выпущенное, а не всё нарисованное.
  -- Отсутствие ключа — утверждение «роль не получает листы», как в v7.
  select membership.role into v_role
  from projectceo_foundation.project_memberships membership
  where membership.organization_id = v_org
    and membership.project_id = project_id
    and membership.user_id = v_actor
    and membership.status = 'active';

  if v_role in ('owner_lead', 'architect') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'sheetId', latest.sheet_id,
      'packageId', latest.package_id,
      'roomId', latest.room_id,
      'sheetNumber', latest.sheet_number,
      'title', latest.title,
      'revisionId', latest.revision_id,
      'revisionNo', latest.revision_no,
      'semanticHash', latest.semantic_hash,
      'specificationRevisionIds', to_jsonb(latest.specification_revision_ids),
      'createdAt', latest.created_at
    ) order by
        latest.sheet_number collate "C",
        latest.sheet_id collate "C"
    ), '[]'::jsonb)
    into v_sheets
    from (
      select distinct on (sheet.sheet_id) sheet.*
      from projectceo_m3.documentation_sheet_revisions sheet
      where sheet.organization_id = v_org
        and sheet.project_id = project_id
        and exists (
          select 1
          from projectceo_product.production_package_versions released
          where released.organization_id = v_org
            and released.project_id = project_id
            and released.package_id = sheet.package_id
        )
      order by sheet.sheet_id, sheet.revision_no desc
    ) latest;
    v_data := v_data || jsonb_build_object('sheets', v_sheets);
  end if;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-released-archive/0.1',
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'data', v_data,
    'error', null
  );
end
$function$;

alter function projectceo_read_api.get_released_archive_read_v1(uuid)
  owner to pi_table_owner;
revoke all on function projectceo_read_api.get_released_archive_read_v1(uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
grant execute on function projectceo_read_api.get_released_archive_read_v1(uuid)
  to authenticated;

-- Гранты и опоры проверяются здесь, а не в браузере.
do $guard$
begin
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_read_api.get_released_archive_read_v1(uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_RELEASED_ARCHIVE_READ_UNREACHABLE';
  end if;
  if pg_catalog.has_function_privilege(
    'anon',
    'projectceo_read_api.get_released_archive_read_v1(uuid)',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_RELEASED_ARCHIVE_READ_LEAKED_TO_ANON';
  end if;
  if to_regprocedure(
    'projectceo_platform.m3_read_gate_open()'
  ) is null then
    raise exception 'PROJECTCEO_M3_READ_GATE_MISSING';
  end if;
end
$guard$;

commit;
