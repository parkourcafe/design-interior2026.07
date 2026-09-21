begin;

-- Один deployment cell обслуживает одну физическую БД. Текущий RU bootstrap
-- содержит одну строку `ru`; будущий US bootstrap создаётся отдельно и обязан
-- содержать одну строку `us`. Смешанное состояние fail closed.
create table project_intelligence.market_routing_receipts (
  user_id uuid primary key references auth.users (id) on delete restrict,
  market text not null check (market in ('ru', 'international')),
  cell_code text not null check (cell_code in ('ru', 'us')),
  receipt_digest text not null unique
    check (receipt_digest ~ '^[0-9a-f]{64}$'),
  declared_market text null check (declared_market in ('ru', 'international')),
  resolution_reason text not null
    check (resolution_reason in ('declared', 'conservative_ru_signal', 'conservative_default')),
  russian_signal_kinds text[] not null default '{}'::text[]
    check (russian_signal_kinds <@ array['trusted_country', 'trusted_phone_country', 'locale']::text[]),
  created_at timestamptz not null default clock_timestamp(),
  constraint market_routing_receipts_market_cell_check check (
    (market = 'ru' and cell_code = 'ru')
    or (market = 'international' and cell_code = 'us')
  )
);

alter table project_intelligence.market_routing_receipts enable row level security;
revoke all on table project_intelligence.market_routing_receipts
  from public, anon, authenticated, service_role;

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
    if v_existing.market <> p_market
       or v_existing.cell_code <> v_cell_code
       or v_existing.receipt_digest <> p_receipt_digest
       or v_existing.declared_market is distinct from p_declared_market
       or v_existing.resolution_reason <> p_reason
       or v_existing.russian_signal_kinds <> coalesce(p_russian_signal_kinds, '{}'::text[]) then
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

alter table project_intelligence.market_routing_receipts owner to pi_table_owner;
alter function projectceo_api.accept_market_routing_receipt(text, text, text, text, text[])
  owner to pi_table_owner;
revoke all on function projectceo_api.accept_market_routing_receipt(text, text, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function projectceo_api.accept_market_routing_receipt(text, text, text, text, text[])
  to authenticated;

commit;
