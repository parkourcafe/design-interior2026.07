-- Повторный вход дизайнера (находка сквозной проверки 28.09).
--
-- Каждый вход в /login выпускает новую подписанную квитанцию рынка (случайный
-- nonce → новый digest). Функция из 20260911100000 сравнивала digest и основание
-- с первой записью и отвечала MARKET_ROUTING_RECEIPT_IMMUTABLE — маршрут
-- /api/auth/market-binding после этого завершал сессию. Итог: войти можно было
-- только один раз.
--
-- Неизменяемой остаётся сама привязка пользователя к рынку и ячейке данных.
-- Первая квитанция остаётся записью (не перезаписывается); повторная квитанция
-- с тем же рынком — replay; попытка сменить рынок — отказ, как и раньше.
-- Проверки формата и согласованности основания не меняются.

begin;

create or replace function projectceo_api.accept_market_routing_receipt(
  p_market text,
  p_receipt_digest text,
  p_declared_market text,
  p_reason text,
  p_russian_signal_kinds text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid := project_intelligence._request_user_id();
  v_cell_codes text[];
  v_cell_code text;
  v_existing project_intelligence.market_routing_receipts%rowtype;
begin
  if v_actor_user_id is null then
    raise exception 'MARKET_ROUTING_AUTH_REQUIRED';
  end if;
  if p_market not in ('ru', 'international')
     or p_declared_market is not null and p_declared_market not in ('ru', 'international')
     or p_reason not in ('declared', 'conservative_ru_signal', 'conservative_default')
     or p_receipt_digest !~ '^[0-9a-f]{64}$'
     or not (coalesce(p_russian_signal_kinds, '{}'::text[]) <@
             array['trusted_country', 'trusted_phone_country', 'locale']::text[]) then
    raise exception 'MARKET_ROUTING_INVALID_RECEIPT';
  end if;
  if p_reason = 'conservative_ru_signal'
     and coalesce(array_length(p_russian_signal_kinds, 1), 0) = 0 then
    raise exception 'MARKET_ROUTING_SIGNAL_BASIS_REQUIRED';
  end if;
  if (p_reason = 'declared' and p_declared_market is distinct from p_market)
     or (p_reason = 'conservative_default'
         and (p_market <> 'ru' or p_declared_market is not null
              or coalesce(array_length(p_russian_signal_kinds, 1), 0) <> 0))
     or (p_reason = 'conservative_ru_signal'
         and (p_market <> 'ru' or p_declared_market = 'ru')) then
    raise exception 'MARKET_ROUTING_INCONSISTENT_BASIS';
  end if;

  select array_agg(cell_code order by cell_code)
    into v_cell_codes
  from project_intelligence.deployment_cells;
  if coalesce(array_length(v_cell_codes, 1), 0) <> 1 then
    raise exception 'MARKET_ROUTING_LOCAL_CELL_AMBIGUOUS';
  end if;
  v_cell_code := v_cell_codes[1];

  if (p_market = 'ru' and v_cell_code <> 'ru')
     or (p_market = 'international' and v_cell_code <> 'us') then
    raise exception 'MARKET_ROUTING_CELL_MISMATCH';
  end if;

  select * into v_existing
  from project_intelligence.market_routing_receipts
  where user_id = v_actor_user_id
  for update;

  if found then
    -- Привязка неизменяема: другой рынок или ячейка — отказ. Новая квитанция
    -- того же рынка — обычный повторный вход; первая запись не меняется.
    if v_existing.market <> p_market or v_existing.cell_code <> v_cell_code then
      raise exception 'MARKET_ROUTING_RECEIPT_IMMUTABLE';
    end if;
    return jsonb_build_object('market', v_existing.market, 'cellCode', v_existing.cell_code, 'replay', true);
  end if;

  insert into project_intelligence.market_routing_receipts (
    user_id, market, cell_code, receipt_digest, declared_market,
    resolution_reason, russian_signal_kinds
  ) values (
    v_actor_user_id, p_market, v_cell_code, p_receipt_digest, p_declared_market,
    p_reason, coalesce(p_russian_signal_kinds, '{}'::text[])
  );

  return jsonb_build_object('market', p_market, 'cellCode', v_cell_code, 'replay', false);
end
$function$;

alter function projectceo_api.accept_market_routing_receipt(text, text, text, text, text[])
  owner to pi_table_owner;
revoke all on function projectceo_api.accept_market_routing_receipt(text, text, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function projectceo_api.accept_market_routing_receipt(text, text, text, text, text[])
  to authenticated;

commit;
