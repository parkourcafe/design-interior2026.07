\set ON_ERROR_STOP on

-- Supabase's managed auth schema grants USAGE only to runtime roles and
-- postgres. Project Intelligence SECURITY DEFINER functions are owned by the
-- guarded NOLOGIN table owner and call auth.uid(), so that owner needs schema
-- lookup. The ledger already grants the NOLOGIN owner SELECT on auth.users for
-- exact invitation/email validation; no other auth-table privilege is allowed.
-- This local-only compatibility
-- bootstrap runs as Supabase's schema owner after every disposable reset.
grant usage on schema auth to pi_table_owner, pi_human_executor;

drop policy if exists projectceo_pi_table_owner_select on auth.users;
create policy projectceo_pi_table_owner_select
  on auth.users
  for select
  to pi_table_owner
  using (true);

do $guard$
begin
  if not has_schema_privilege('pi_table_owner', 'auth', 'USAGE')
     or not has_schema_privilege('pi_human_executor', 'auth', 'USAGE')
     or has_schema_privilege('pi_worker_executor', 'auth', 'USAGE') then
    raise exception 'AP1_AUTH_SCHEMA_COMPAT_GRANT_FAILED';
  end if;
  if (
    select count(*)
    from information_schema.table_privileges privilege
    where privilege.grantee = 'pi_table_owner'
      and privilege.table_schema = 'auth'
      and privilege.table_name = 'users'
      and privilege.privilege_type = 'SELECT'
  ) <> 1 or exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.grantee = 'pi_table_owner'
      and privilege.table_schema = 'auth'
      and (privilege.table_name, privilege.privilege_type)
        is distinct from ('users', 'SELECT')
  ) then
    raise exception 'AP1_AUTH_TABLE_PRIVILEGE_SCOPE_INVALID';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'auth'
      and policy.tablename = 'users'
      and policy.policyname = 'projectceo_pi_table_owner_select'
      and policy.cmd = 'SELECT'
      and policy.roles = array['pi_table_owner']::name[]
      and policy.qual = 'true'
  ) then
    raise exception 'AP1_AUTH_USERS_POLICY_SCOPE_INVALID';
  end if;
end
$guard$;
