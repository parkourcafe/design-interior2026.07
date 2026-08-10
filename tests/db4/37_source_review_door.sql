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
