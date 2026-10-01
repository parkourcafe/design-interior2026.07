\set ON_ERROR_STOP on

-- DB4-92: после запроса удаления чтение через API закрыто сразу (DEC-047 (g),
-- решение владельца 01.10.2026; миграция 20260928163000). Проверяется
-- функция db-pre-request PostgREST напрямую, с теми же настройками запроса,
-- что ставит PostgREST (роль, request.jwt.claims, request.path).
-- Сид: дизайнеры 31111111 и 33333333. Одна транзакция с откатом.

begin;

create function pg_temp.guard_as(p_role text, p_sub text, p_path text) returns text
language plpgsql as $function$
declare
  v_state text;
  v_text text;
begin
  perform pg_catalog.set_config('request.jwt.claims',
    case when p_sub is null then '' else pg_catalog.json_build_object('sub', p_sub, 'role', p_role)::text end, true);
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(p_sub, ''), true);
  perform pg_catalog.set_config('request.path', p_path, true);
  perform pg_catalog.set_config('role', p_role, true);
  begin
    perform public.account_closed_request_guard();
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_text = message_text;
    perform pg_catalog.set_config('role', 'postgres', true);
    return v_state || ':' || v_text;
  end;
  perform pg_catalog.set_config('role', 'postgres', true);
  return 'pass';
end
$function$;

do $rights$
begin
  if not pg_catalog.has_function_privilege('authenticated', 'public.account_closed_request_guard()', 'EXECUTE')
     or not pg_catalog.has_function_privilege('anon', 'public.account_closed_request_guard()', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.account_closed_request_guard()', 'EXECUTE') then
    raise exception 'DB4_92_GUARD_NOT_EXECUTABLE';
  end if;
end
$rights$;

do $guard$
declare
  v_closed constant text := '31111111-1111-4111-8111-111111111111';
  v_other constant text := '33333333-3333-4333-8333-333333333333';
  v_result text;
begin
  -- До запроса — пропуск.
  if pg_temp.guard_as('authenticated', v_closed, '/projects') <> 'pass' then
    raise exception 'DB4_92_BLOCKED_BEFORE_REQUEST';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_closed, true);
  perform pg_catalog.set_config('role', 'authenticated', true);
  perform public.request_account_deletion('DB4-92');
  perform pg_catalog.set_config('role', 'postgres', true);

  -- После запроса: любые запросы — 403, кроме статуса заявки.
  foreach v_result in array array[
    pg_temp.guard_as('authenticated', v_closed, '/projects'),
    pg_temp.guard_as('authenticated', v_closed, '/rpc/export_passport_revisions'),
    pg_temp.guard_as('authenticated', v_closed, '/designers')
  ] loop
    if v_result <> 'PT403:ACCOUNT_CLOSED' then
      raise exception 'DB4_92_NOT_CLOSED:%', v_result;
    end if;
  end loop;
  if pg_temp.guard_as('authenticated', v_closed, '/rpc/get_account_retention_status') <> 'pass'
     or pg_temp.guard_as('authenticated', v_closed, '/rpc/accept_market_routing_receipt') <> 'pass' then
    raise exception 'DB4_92_SIGN_IN_RPCS_BLOCKED';
  end if;
  -- Другие: второй дизайнер, anon, service_role — пропуск.
  if pg_temp.guard_as('authenticated', v_other, '/projects') <> 'pass'
     or pg_temp.guard_as('anon', null, '/rpc/anything') <> 'pass'
     or pg_temp.guard_as('service_role', v_closed, '/projects') <> 'pass' then
    raise exception 'DB4_92_OTHERS_BLOCKED';
  end if;
  -- После восстановления оператором — снова пропуск.
  perform public.restore_account_retention_case(v_closed::uuid, 'ошибка', 'ops');
  if pg_temp.guard_as('authenticated', v_closed, '/projects') <> 'pass' then
    raise exception 'DB4_92_BLOCKED_AFTER_RESTORE';
  end if;
end
$guard$;

rollback;

select 'DB4_ACCOUNT_CLOSED_API_GUARD_OK' as result;
