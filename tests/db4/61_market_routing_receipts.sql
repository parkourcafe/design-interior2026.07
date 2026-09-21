\set ON_ERROR_STOP on

do $market_routing_contract$
declare
  v_result jsonb;
  v_function oid := to_regprocedure(
    'projectceo_api.accept_market_routing_receipt(text,text,text,text,text[])'
  );
begin
  if v_function is null
     or pg_get_userbyid((select proowner from pg_proc where oid = v_function)) <> 'pi_table_owner'
     or not (select prosecdef from pg_proc where oid = v_function)
     or coalesce(array_to_string((select proconfig from pg_proc where oid = v_function), ','), '') !~
          '(^|,)search_path=""(,|$)' then
    raise exception 'DB4_MARKET_ROUTING_RPC_UNSAFE';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     or exists (
       select 1 from unnest(array['public', 'anon', 'service_role', 'pi_human_executor', 'pi_worker_executor']) role_name
       where pg_catalog.has_function_privilege(role_name, v_function, 'EXECUTE')
     ) then
    raise exception 'DB4_MARKET_ROUTING_RPC_GRANT';
  end if;
  if exists (
    select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role']) role_name
    where has_table_privilege(role_name, 'project_intelligence.market_routing_receipts', 'SELECT,INSERT,UPDATE,DELETE')
  ) then
    raise exception 'DB4_MARKET_ROUTING_TABLE_DIRECT_ACCESS';
  end if;
end
$market_routing_contract$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '78888888-8888-4888-8888-888888888801';

do $market_routing_positive$
declare v_result jsonb;
begin
  select projectceo_api.accept_market_routing_receipt(
    'ru', repeat('a', 64), 'ru', 'declared', array[]::text[]
  ) into v_result;
  if v_result->>'market' <> 'ru' or v_result->>'cellCode' <> 'ru' or v_result->>'replay' <> 'false' then
    raise exception 'DB4_MARKET_ROUTING_POSITIVE:%', v_result;
  end if;

  select projectceo_api.accept_market_routing_receipt(
    'ru', repeat('a', 64), 'ru', 'declared', array[]::text[]
  ) into v_result;
  if v_result->>'replay' <> 'true' then
    raise exception 'DB4_MARKET_ROUTING_REPLAY:%', v_result;
  end if;
end
$market_routing_positive$;

do $market_routing_denials$
begin
  begin
    perform projectceo_api.accept_market_routing_receipt(
      'international', repeat('b', 64), 'international', 'declared', array[]::text[]
    );
    raise exception 'DB4_MARKET_ROUTING_CROSS_CELL_ALLOWED';
  exception when raise_exception then
    if position('MARKET_ROUTING_CELL_MISMATCH' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform projectceo_api.accept_market_routing_receipt(
      'ru', repeat('c', 64), 'ru', 'declared', array[]::text[]
    );
    raise exception 'DB4_MARKET_ROUTING_MUTATION_ALLOWED';
  exception when raise_exception then
    if position('MARKET_ROUTING_RECEIPT_IMMUTABLE' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform projectceo_api.accept_market_routing_receipt(
      'international', repeat('d', 64), 'ru', 'declared', array[]::text[]
    );
    raise exception 'DB4_MARKET_ROUTING_INCONSISTENT_BASIS_ALLOWED';
  exception when raise_exception then
    if position('MARKET_ROUTING_INCONSISTENT_BASIS' in sqlerrm) = 0 then raise; end if;
  end;
end
$market_routing_denials$;
rollback;

select 'DB4_MARKET_ROUTING_RECEIPTS_OK' as result;
