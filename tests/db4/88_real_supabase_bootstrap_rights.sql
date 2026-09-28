\set ON_ERROR_STOP on

-- DB4-88: права, которые на настоящем Supabase ведут себя не так, как у
-- суперпользователя харнесса (находка 28.09, миграции 20260928095900,
-- 20260928154000, 20260928155000).
-- 1. Временное право CREATE на public у pi_table_owner забрано.
-- 2. Ни одна SECURITY DEFINER-функция pi_table_owner не обращается к схеме
--    auth: у владельца на Supabase нет к ней доступа.
-- 3. Переписанные функции берут пользователя из JWT запроса.

do $rights$
begin
  if pg_catalog.has_schema_privilege('pi_table_owner', 'public', 'CREATE') then
    raise exception 'DB4_88_PUBLIC_CREATE_LEFT';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
    where p.prosecdef
      and pg_catalog.pg_get_userbyid(p.proowner) = 'pi_table_owner'
      and p.prosrc ~ '\mauth\.'
  ) then
    raise exception 'DB4_88_DEFINER_USES_AUTH_SCHEMA';
  end if;
  if pg_catalog.pg_get_userbyid((select proowner from pg_catalog.pg_proc
       where oid = 'public.get_account_retention_status()'::regprocedure)) <> 'pi_table_owner'
     or not pg_catalog.has_function_privilege('authenticated', 'public.get_account_retention_status()', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.request_account_deletion(text)', 'EXECUTE') then
    raise exception 'DB4_88_REWRITE_CHANGED_OWNER_OR_ACL';
  end if;
end
$rights$;

begin;
insert into auth.users (id, email) values ('48888888-8888-4888-8888-888888888888', 'db4-88@example.test')
  on conflict do nothing;
insert into public.designers (id, name) values ('48888888-8888-4888-8888-888888888888', 'DB4 88')
  on conflict do nothing;
set local role authenticated;
set local request.jwt.claims = '{"sub":"48888888-8888-4888-8888-888888888888","role":"authenticated"}';
do $request_user$
begin
  if (public.request_account_deletion('db4-88') ->> 'status') <> 'requested'
     or (public.get_account_retention_status() ->> 'status') <> 'requested' then
    raise exception 'DB4_88_REQUEST_USER_NOT_RESOLVED';
  end if;
end
$request_user$;
rollback;

select 'DB4_REAL_SUPABASE_BOOTSTRAP_RIGHTS_OK' as result;
