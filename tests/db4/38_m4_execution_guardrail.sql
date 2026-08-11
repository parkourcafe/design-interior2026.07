\set ON_ERROR_STOP on

-- Guardrail модуля 4 на границе базы.
--
-- Вопрос, с которого всё началось: можно ли обойти `command-service.ts` прямым
-- вызовом RPC модуля 4. Ответ был «да»: схема `projectceo_m4_api` отдана Data
-- API (`supabase/config.toml`), а её команды выданы роли `authenticated`
-- (`20260717103000`). Флаг в приложении такого вызова не видит — вызов до
-- приложения не доходит.
--
-- Миграция `20260810070000` закрывает эту границу. Сценарий доказывает, что
-- закрытие настоящее, а не декларация, и что оно не задело чтение.

do $db4_m4_guardrail$
declare
  v_reachable text;
  v_count integer;
begin
  -- 1. Ни одна команда модуля не достижима ролью `authenticated`.
  --    Проверка сплошная: перечислять имена бессмысленно — именно ручной
  --    перечень и подвёл при подготовке миграции, пропустив пять
  --    `replay_*`-обёрток.
  select p.proname into v_reachable
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_m4_api'
    and p.proname <> 'get_execution_delivery'
    and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  limit 1;
  if v_reachable is not null then
    raise exception 'DB4_M4_COMMAND_REACHABLE_BY_AUTHENTICATED:%', v_reachable;
  end if;

  -- 2. Ровно одно исключение — читающая RPC рабочего пространства. Без неё
  --    guardrail превратился бы в поломку чтения проекта.
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'projectceo_m4_api.get_execution_delivery(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'DB4_M4_DELIVERY_READ_LOST';
  end if;

  -- 3. Запрет именно на `authenticated`. Воркерные функции — расчёт влияния и
  --    сборка передачи — выданы `service_role` (`20260717103000`, второй блок
  --    grant), и guardrail их не касается: он закрывает человеческую
  --    поверхность, а не контур расчётов.
  --
  --    Проверено при написании сценария: у `pi_worker_executor` прав на эту
  --    схему нет и не было — воркер ходит под `service_role`. Assertion писался
  --    по первому предположению и был им же опровергнут, поэтому здесь стоит
  --    факт, а не догадка.
  select count(*) into v_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'projectceo_m4_api'
    and p.proname in ('calculate_change_impact', 'build_construction_handover')
    and pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE');
  if v_count <> 2 then
    raise exception 'DB4_M4_WORKER_PATH_BROKEN:%', v_count;
  end if;

  -- 4. Схема остаётся отданной Data API — ради пункта 2. Если её однажды
  --    закроют целиком, чтение исполнения умрёт молча, поэтому usage
  --    проверяется отдельно от execute.
  if not pg_catalog.has_schema_privilege(
    'authenticated', 'projectceo_m4_api', 'USAGE'
  ) then
    raise exception 'DB4_M4_SCHEMA_USAGE_LOST';
  end if;
end
$db4_m4_guardrail$;

-- Поведенческая проверка, а не только права: живая сессия члена проекта с
-- ролью, у которой capability есть, всё равно получает отказ.
do $db4_m4_guardrail_behaviour$
declare
  v_state text;
begin
  begin
    set local role authenticated;
    perform pg_catalog.set_config(
      'request.jwt.claim.sub', '31111111-1111-4111-8111-111111111111', true
    );
    perform projectceo_m4_api.accept_milestone(
      '41111111-1111-4111-8111-111111111111',
      '5eeeeeee-1111-4111-8111-111111111111'::uuid,
      1,
      'db4-guardrail-direct-call'
    );
    raise exception 'DB4_M4_DIRECT_CALL_ALLOWED';
  exception
    -- 42501 insufficient_privilege — вызов не дошёл до тела функции вовсе.
    -- Это и есть доказательство: отказ даёт база, а не проверка внутри.
    when insufficient_privilege then
      null;
  end;
end
$db4_m4_guardrail_behaviour$;
