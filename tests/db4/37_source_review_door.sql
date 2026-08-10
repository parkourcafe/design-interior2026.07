\set ON_ERROR_STOP on

-- Дверь ревью источника: `projectceo_api.review_source`.
--
-- Гейт AP5 поймал 500 на решении по источнику. Причина была не в графе
-- утверждений, а в границе схем: решение пишет
-- `project_intelligence_api.review_claim`, а эта схема намеренно не отдана Data
-- API (`supabase/config.toml`; `verify-runtime.mjs` требует от неё 406). Вызов
-- не находился PostgREST, ошибка не ложилась ни на один SQLSTATE и выходила
-- наружу как `internal_error`.
--
-- Миграция `20260810050000` завела тонкую делегирующую функцию в уже отданной
-- `projectceo_api`. Этот сценарий доказывает две вещи, которые дверь обязана
-- соблюдать: она НЕ добавляет прав и она НЕ прячет отказы.

do $db4_review_door_shape$
declare
  v_proc pg_catalog.pg_proc%rowtype;
  v_grantee text;
begin
  select p.* into v_proc
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_api'
    and p.proname = 'review_source';
  if not found then
    raise exception 'DB4_REVIEW_DOOR_MISSING';
  end if;

  -- `security invoker` — тело выполняется от имени вызывающего. Дверь с
  -- `security definer` тихо подарила бы права владельца всем, кому дан execute.
  if v_proc.prosecdef then
    raise exception 'DB4_REVIEW_DOOR_MUST_NOT_BE_DEFINER';
  end if;

  if v_proc.proconfig is null
     or not exists (
       select 1
       from unnest(v_proc.proconfig) entry
       where entry ~ '^search_path=("")?$'
     ) then
    raise exception 'DB4_REVIEW_DOOR_SEARCH_PATH_NOT_PINNED';
  end if;

  -- Внутри — ровно делегирование, а не своя копия логики решения.
  if pg_catalog.pg_get_functiondef(v_proc.oid)
       !~ 'project_intelligence_api\.review_claim' then
    raise exception 'DB4_REVIEW_DOOR_DOES_NOT_DELEGATE';
  end if;

  -- Execute — только у `authenticated`. Ни anon, ни service_role, ни исполнители.
  foreach v_grantee in array array[
    'anon', 'service_role', 'pi_human_executor', 'pi_worker_executor'
  ] loop
    if pg_catalog.has_function_privilege(
      v_grantee,
      'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
      'EXECUTE'
    ) then
      raise exception 'DB4_REVIEW_DOOR_OVERGRANTED:%', v_grantee;
    end if;
  end loop;
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_api.review_source(uuid, text, text, bigint, text, text)',
    'EXECUTE'
  ) then
    raise exception 'DB4_REVIEW_DOOR_UNREACHABLE';
  end if;

  -- Главное про «не добавляет прав»: до двери у `authenticated` уже были и
  -- usage на приватную api-схему, и execute на саму `review_claim`. Дверь
  -- меняет только достижимость через Data API. Если это перестанет быть
  -- правдой, дверь превратится в расширение доступа — и сценарий обязан упасть.
  if not pg_catalog.has_schema_privilege(
    'authenticated', 'project_intelligence_api', 'USAGE'
  ) then
    raise exception 'DB4_REVIEW_DOOR_WOULD_WIDEN_SCHEMA_ACCESS';
  end if;
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'project_intelligence_api.review_claim(uuid, text, text, bigint, text, text)',
    'EXECUTE'
  ) then
    raise exception 'DB4_REVIEW_DOOR_WOULD_WIDEN_EXECUTE';
  end if;
end
$db4_review_door_shape$;

-- Положительный путь: член проекта с capability review_claim решает по ревизии
-- через дверь, и решение доходит до append-only журнала.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
select projectceo_api.review_source(
  '41111111-1111-4111-8111-111111111111',
  'revision-requirement-db4',
  'revision-requirement-db4',
  50,
  'confirmed',
  'db4-door-confirm'
);
commit;

do $db4_review_door_effect$
declare
  v_status text;
begin
  if not exists (
    select 1
    from project_intelligence.human_reviews
    where project_id = '41111111-1111-4111-8111-111111111111'
      and target_revision_id = 'revision-requirement-db4'
      and decision = 'confirmed'
      and actor_user_id = '31111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'DB4_REVIEW_DOOR_DECISION_NOT_RECORDED';
  end if;

  -- Идемпотентность у двери не своя: её обеспечивает та же `review_claim`
  -- через журнал команд. Запись обязана лечь именно под операцией
  -- `review_claim` — дверь не заводит собственной операции и собственного
  -- пространства ключей.
  if not exists (
    select 1
    from project_intelligence.command_records
    where project_id = '41111111-1111-4111-8111-111111111111'
      and operation = 'review_claim'
      and logical_result -> 'review' ->> 'targetRevisionId'
          = 'revision-requirement-db4'
  ) then
    raise exception 'DB4_REVIEW_DOOR_COMMAND_NOT_LEDGERED';
  end if;
end
$db4_review_door_effect$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '31111111-1111-4111-8111-111111111111';
do $db4_review_door_replay$
declare
  v_result jsonb;
begin
  v_result := projectceo_api.review_source(
    '41111111-1111-4111-8111-111111111111',
    'revision-requirement-db4',
    'revision-requirement-db4',
    50,
    'confirmed',
    'db4-door-confirm'
  );
  if v_result ->> 'replay' is distinct from 'true' then
    raise exception 'DB4_REVIEW_DOOR_REPLAY_LOST:%', v_result;
  end if;
end
$db4_review_door_replay$;
commit;

-- Отказы. Дверь ничего не смягчает: каждый случай выходит тем же SQLSTATE,
-- который приложение уже умеет отображать (`errors.ts`).
do $db4_review_door_refusals$
begin
  -- Не член проекта — P1103 forbidden. Авторизацию по-прежнему делает
  -- внутренняя функция через `_human_context`, а не дверь.
  begin
    set local role authenticated;
    perform pg_catalog.set_config(
      'request.jwt.claim.sub', '39999999-9999-4999-8999-999999999999', true
    );
    perform projectceo_api.review_source(
      '41111111-1111-4111-8111-111111111111',
      'revision-area-db4',
      'revision-area-db4',
      51,
      'confirmed',
      'db4-door-forbidden'
    );
    raise exception 'DB4_REVIEW_DOOR_ALLOWED_NON_MEMBER';
  exception when sqlstate 'P1103' then
    null;
  end;

  -- Устаревшая ревизия состояния — P1006 stale_state, оптимистичная
  -- блокировка сквозь дверь работает.
  begin
    set local role authenticated;
    perform pg_catalog.set_config(
      'request.jwt.claim.sub', '31111111-1111-4111-8111-111111111111', true
    );
    perform projectceo_api.review_source(
      '41111111-1111-4111-8111-111111111111',
      'revision-area-db4',
      'revision-area-db4',
      7,
      'confirmed',
      'db4-door-stale'
    );
    raise exception 'DB4_REVIEW_DOOR_IGNORED_STALE_STATE';
  exception when sqlstate 'P1006' then
    null;
  end;

  -- Повторное решение по уже отрецензированной ревизии. Без двери здесь
  -- выходил сырой 23505: SQLSTATE, не отображённый ни на один код ошибки, то
  -- есть снова 500 у пользователя. Дверь переводит его в P1009 scope_conflict —
  -- смысл тот же, но приложение умеет его показать.
  begin
    set local role authenticated;
    perform pg_catalog.set_config(
      'request.jwt.claim.sub', '31111111-1111-4111-8111-111111111111', true
    );
    perform projectceo_api.review_source(
      '41111111-1111-4111-8111-111111111111',
      'revision-source-1',
      'revision-source-1',
      51,
      'rejected',
      'db4-door-already-decided'
    );
    raise exception 'DB4_REVIEW_DOOR_ALLOWED_SECOND_DECISION';
  exception
    when sqlstate '23505' then
      raise exception 'DB4_REVIEW_DOOR_LEAKS_RAW_UNIQUE_VIOLATION';
    when sqlstate 'P1009' then
      null;
  end;
end
$db4_review_door_refusals$;

-- Вторая половина находки AP5: поверхность не должна предлагать ревизию,
-- которой нет в графе утверждений.
--
-- Источник, заведённый человеком, попадает в инвентарь, но узлы графа создаёт
-- воркерный `ingest_source_graph`. Чтение до v8 отдавало
-- `reviewTargetRevisionId` прямо из инвентаря, и кнопка ревью выглядела
-- рабочей; `review_claim` отвечал на неё `P1004 REVISION_STALE` с
-- `currentRevisionId: null`. v8 (`20260810060000`) сужает ровно это поле.
do $db4_review_target_requires_graph$
declare
  v_v7 jsonb;
  v_v8 jsonb;
  v_revision bigint;
  v_inventory_only text := 'db4-inventory-only-revision';
begin
  -- Регистрация идёт настоящей командой, а не вставкой в таблицу: именно так
  -- источник заводит человек из браузера, и именно её результат читает v8.
  select state_revision into v_revision
  from project_intelligence.project_workflows
  where project_id = '41111111-1111-4111-8111-111111111111';

  perform set_config('request.jwt.claim.sub',
    '31111111-1111-4111-8111-111111111111', true);
  set local role authenticated;
  perform projectceo_api.register_source_inventory(
    '41111111-1111-4111-8111-111111111111',
    jsonb_build_array(jsonb_build_object(
      'physicalRecordId', '5ddddddd-1111-4111-8111-111111111111',
      'sanitizedName', 'db4-inventory-only.pdf',
      'hierarchy', jsonb_build_object(
        'projectId', '41111111-1111-4111-8111-111111111111',
        'packageId', '41111111-1111-4111-8111-111111111111',
        'floorId', 'floor-db4',
        'zoneId', 'zone-db4',
        'disciplineId', 'architecture'
      ),
      'availability', 'materialized',
      'documentStatus', 'current',
      'sizeBytes', 1024,
      'checksum', repeat('d', 64),
      'sourceRevisionId', v_inventory_only,
      'semanticConflict', false
    )),
    jsonb_build_object(
      'projectId', '41111111-1111-4111-8111-111111111111',
      'entries', jsonb_build_array(),
      'exactHashGroups', jsonb_build_array()
    ),
    v_revision,
    'db4-inventory-only-register'
  );
  reset role;

  perform set_config('request.jwt.claim.sub',
    '31111111-1111-4111-8111-111111111111', true);
  set local role authenticated;
  v_v7 := projectceo_read_api.get_project_workspace_read_v7(
    '41111111-1111-4111-8111-111111111111', null);
  v_v8 := projectceo_read_api.get_project_workspace_read_v8(
    '41111111-1111-4111-8111-111111111111', null);
  reset role;

  -- v8 обязана сузить поле, иначе чинить было нечего.
  if (
    select s ->> 'reviewTargetRevisionId'
    from jsonb_array_elements(v_v8 #> '{data,sources}') s
    where s ->> 'sourceRevisionId' = v_inventory_only
  ) is not null then
    raise exception 'DB4_REVIEW_TARGET_OFFERED_WITHOUT_GRAPH';
  end if;

  -- ...и обязана сузить ТОЛЬКО его: источник, у которого ревизия в графе есть,
  -- по-прежнему рецензируем, иначе v8 просто сломала бы ревью целиком.
  if (
    select s ->> 'reviewTargetRevisionId'
    from jsonb_array_elements(v_v8 #> '{data,sources}') s
    where s ->> 'sourceRevisionId' = 'revision-source-1'
  ) is distinct from 'revision-source-1' then
    raise exception 'DB4_REVIEW_TARGET_LOST_FOR_GRAPH_BACKED_SOURCE';
  end if;

  -- Ничего, кроме этого поля, v8 не трогает: состав и число источников те же.
  if jsonb_array_length(v_v8 #> '{data,sources}')
     <> jsonb_array_length(v_v7 #> '{data,sources}') then
    raise exception 'DB4_REVIEW_READ_V8_CHANGED_SOURCE_COUNT';
  end if;
  if (v_v8 ->> 'stateRevision') is distinct from (v_v7 ->> 'stateRevision') then
    raise exception 'DB4_REVIEW_READ_V8_CHANGED_STATE_REVISION';
  end if;
end
$db4_review_target_requires_graph$;
