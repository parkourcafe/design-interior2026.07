-- DEC-047 (g), решение владельца 01.10.2026: после запроса удаления аккаунта
-- дизайнер сразу теряет и чтение своих данных через API (раньше — только в
-- точке невозврата, когда блокируется вход).
--
-- 1. PostgREST db-pre-request: перед каждым запросом во всех схемах API
--    (и с уже выданными токенами) — отказ 403 ACCOUNT_CLOSED, если роль
--    запроса authenticated и пользователь — дизайнер с живой заявкой на
--    удаление. Разрешены только два служебных RPC входа, данных они не
--    отдают: статус заявки (экран «Аккаунт закрыт» с датой и поддержкой) и
--    фиксация контура при входе (projectceo_api.accept_market_routing_receipt
--    — без неё вход не доходит до экрана «Аккаунт закрыт»).
--    anon и service_role не затрагиваются (клиентские ссылки закрыты
--    отдельно; серверные операции и скрипты оператора работают).
-- 2. Хранилище: ограничивающая политика чтения storage.objects для такого
--    пользователя.

begin;

create function public.account_closed_request_guard()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_sub text;
begin
  if current_user <> 'authenticated' then
    return;
  end if;
  if coalesce(pg_catalog.current_setting('request.path', true), '')
       in ('/rpc/get_account_retention_status', '/rpc/accept_market_routing_receipt') then
    return;
  end if;
  v_sub := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
  if v_sub is not null
     and v_sub ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and public._designer_in_retention(v_sub::uuid) then
    raise sqlstate 'PT403' using message = 'ACCOUNT_CLOSED',
      hint = 'Удаление аккаунта запрошено: доступ к данным закрыт.';
  end if;
end
$function$;

revoke all on function public.account_closed_request_guard() from public;
grant execute on function public.account_closed_request_guard() to anon, authenticated, service_role;

-- Роль PostgREST есть на Supabase и в комплекте deploy/self-hosted; в
-- харнессе DB4 её нет.
do $pre_request$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator') then
    alter role authenticator set pgrst.db_pre_request = 'public.account_closed_request_guard';
  end if;
end
$pre_request$;
notify pgrst, 'reload config';

do $storage_policy$
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute $policy$
      drop policy if exists account_closed_no_read on storage.objects;
      create policy account_closed_no_read
        on storage.objects
        as restrictive
        for select
        to authenticated
        using (not public._designer_in_retention(auth.uid()))
    $policy$;
  end if;
end
$storage_policy$;

commit;
