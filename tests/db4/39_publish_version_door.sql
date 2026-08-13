\set ON_ERROR_STOP on

-- Дверь публикации версии графа: `projectceo_api.publish_version`.
--
-- Зачем она есть. `publish_project_baseline` требует строку
-- `project_intelligence.project_versions`, иначе отвечает
-- `P1104 not_found {"entity":"graphVersion"}`. Версию создаёт
-- `project_intelligence_api.publish_version`, а эта схема намеренно не отдана
-- Data API — то есть браузерный путь не мог создать версию вовсе, и выход M3
-- был недостижим не из-за дескриптора baseline, а из-за отсутствия шага перед
-- ним. Тот же класс дефекта, что закрыла дверь `review_source`.
--
-- Сценарий доказывает две вещи, которые дверь обязана соблюдать: она НЕ
-- добавляет прав и она НЕ прячет отказы.

do $db4_publish_version_shape$
declare
  v_proc pg_catalog.pg_proc%rowtype;
  v_grantee text;
begin
  select p.* into v_proc
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_api'
    and p.proname = 'publish_version';
  if not found then
    raise exception 'DB4_PUBLISH_VERSION_DOOR_MISSING';
  end if;

  -- `security invoker`: тело исполняется от имени вызывающего. С `definer`
  -- дверь тихо подарила бы права владельца всем, кому дан execute.
  if v_proc.prosecdef then
    raise exception 'DB4_PUBLISH_VERSION_DOOR_MUST_NOT_BE_DEFINER';
  end if;

  if v_proc.proconfig is null
     or not exists (
       select 1
       from unnest(v_proc.proconfig) entry
       where entry ~ '^search_path=("")?$'
     ) then
    raise exception 'DB4_PUBLISH_VERSION_DOOR_SEARCH_PATH_NOT_PINNED';
  end if;

  -- Function-level statement_timeout (`20260813040000`). PostgREST применяет
  -- proconfig вызываемой функции до основного statement — только так публикация
  -- версии на графе >5000 узлов переживает ролевые 8 секунд `authenticated`,
  -- не растягивая лимит ни роли, ни всем остальным запросам.
  if not exists (
       select 1
       from unnest(v_proc.proconfig) entry
       where entry = 'statement_timeout=30s'
     ) then
    raise exception 'DB4_PUBLISH_VERSION_DOOR_TIMEOUT_NOT_PINNED';
  end if;

  -- Внутри — делегирование, а не своя копия логики публикации версии.
  if pg_catalog.pg_get_functiondef(v_proc.oid)
       !~ 'project_intelligence_api\.publish_version' then
    raise exception 'DB4_PUBLISH_VERSION_DOOR_DOES_NOT_DELEGATE';
  end if;

  foreach v_grantee in array array[
    'anon', 'service_role', 'pi_human_executor', 'pi_worker_executor'
  ] loop
    if pg_catalog.has_function_privilege(
      v_grantee,
      'projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)',
      'EXECUTE'
    ) then
      raise exception 'DB4_PUBLISH_VERSION_DOOR_OVERGRANTED:%', v_grantee;
    end if;
  end loop;
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_api.publish_version(uuid, text, bigint, text, jsonb, text)',
    'EXECUTE'
  ) then
    raise exception 'DB4_PUBLISH_VERSION_DOOR_UNREACHABLE';
  end if;

  -- Главное про «не добавляет прав»: до двери у `authenticated` уже были и
  -- usage на приватную api-схему, и execute на саму `publish_version`. Дверь
  -- меняет только достижимость через Data API. Если это перестанет быть
  -- правдой, дверь станет расширением доступа — и сценарий обязан упасть.
  if not pg_catalog.has_schema_privilege(
    'authenticated', 'project_intelligence_api', 'USAGE'
  ) then
    raise exception 'DB4_PUBLISH_VERSION_WOULD_WIDEN_SCHEMA_ACCESS';
  end if;
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'project_intelligence_api.publish_version(uuid, text, bigint, text, jsonb, text)',
    'EXECUTE'
  ) then
    raise exception 'DB4_PUBLISH_VERSION_WOULD_WIDEN_EXECUTE';
  end if;
end
$db4_publish_version_shape$;

-- Положительный путь: член проекта публикует версию графа через дверь, и
-- версия действительно появляется — то есть предпосылка baseline закрывается.
do $db4_publish_version_effect$
declare
  v_revision bigint;
  v_base text;
  v_result jsonb;
  v_new_version text;
begin
  select state_revision into v_revision
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';

  select version_id into v_base
  from project_intelligence.project_versions
  where project_id = '41111111-1111-4111-8111-111111111111'
  order by version_no desc
  limit 1;
  if v_base is null then
    raise exception 'DB4_PUBLISH_VERSION_NO_BASE_VERSION';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub', '31111111-1111-4111-8111-111111111111', true
  );
  set local role authenticated;
  v_result := projectceo_api.publish_version(
    '41111111-1111-4111-8111-111111111111',
    v_base,
    v_revision,
    'DB4 door version',
    '[]'::jsonb,
    'db4-publish-version-door'
  );
  reset role;

  v_new_version := v_result #>> '{result,version,id}';
  if v_new_version is null then
    raise exception 'DB4_PUBLISH_VERSION_NO_RESULT:%', v_result;
  end if;

  -- Ради чего всё: строка версии существует, значит `publish_baseline` больше
  -- не упрётся в `not_found: graphVersion` на этом проекте.
  if not exists (
    select 1
    from project_intelligence.project_versions
    where project_id = '41111111-1111-4111-8111-111111111111'
      and version_id = v_new_version
  ) then
    raise exception 'DB4_PUBLISH_VERSION_ROW_MISSING';
  end if;

  -- Идемпотентность не своя: её обеспечивает внутренняя функция через журнал
  -- команд. Дверь не заводит собственной операции и своего пространства ключей.
  if not exists (
    select 1
    from project_intelligence.command_records
    where project_id = '41111111-1111-4111-8111-111111111111'
      and operation = 'publish_version'
  ) then
    raise exception 'DB4_PUBLISH_VERSION_COMMAND_NOT_LEDGERED';
  end if;
end
$db4_publish_version_effect$;

-- Отказы. Дверь ничего не смягчает: каждый случай выходит тем SQLSTATE,
-- который приложение уже умеет отображать (`errors.ts`).
do $db4_publish_version_refusals$
declare
  v_revision bigint;
  v_base text;
begin
  select state_revision into v_revision
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';
  select version_id into v_base
  from project_intelligence.project_versions
  where project_id = '41111111-1111-4111-8111-111111111111'
  order by version_no desc
  limit 1;

  -- Не член проекта — P1103 forbidden. Авторизацию по-прежнему делает
  -- внутренняя функция через `_human_context`, а не дверь.
  begin
    set local role authenticated;
    perform pg_catalog.set_config(
      'request.jwt.claim.sub', '39999999-9999-4999-8999-999999999999', true
    );
    perform projectceo_api.publish_version(
      '41111111-1111-4111-8111-111111111111',
      v_base, v_revision, 'x', '[]'::jsonb, 'db4-pv-forbidden'
    );
    raise exception 'DB4_PUBLISH_VERSION_ALLOWED_NON_MEMBER';
  exception when sqlstate 'P1103' then
    null;
  end;

  -- Устаревшая ревизия состояния — P1006: оптимистичная блокировка сквозь
  -- дверь работает.
  begin
    set local role authenticated;
    perform pg_catalog.set_config(
      'request.jwt.claim.sub', '31111111-1111-4111-8111-111111111111', true
    );
    perform projectceo_api.publish_version(
      '41111111-1111-4111-8111-111111111111',
      v_base, 7, 'x', '[]'::jsonb, 'db4-pv-stale-state'
    );
    raise exception 'DB4_PUBLISH_VERSION_IGNORED_STALE_STATE';
  exception when sqlstate 'P1006' then
    null;
  end;

  -- Не та базовая версия — P1005 VERSION_STALE. Это защита от гонки двух
  -- публикаций, и она обязана переживать делегирование.
  begin
    set local role authenticated;
    perform pg_catalog.set_config(
      'request.jwt.claim.sub', '31111111-1111-4111-8111-111111111111', true
    );
    perform projectceo_api.publish_version(
      '41111111-1111-4111-8111-111111111111',
      'version:00000000-0000-4000-8000-000000000000',
      v_revision, 'x', '[]'::jsonb, 'db4-pv-version-stale'
    );
    raise exception 'DB4_PUBLISH_VERSION_IGNORED_STALE_BASE';
  exception when sqlstate 'P1005' then
    null;
  end;
end
$db4_publish_version_refusals$;
