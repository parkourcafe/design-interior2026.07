\set ON_ERROR_STOP on

-- ProjectCEO SECURITY DEFINER functions resolve the actor from signed request
-- claims, not auth.uid()/auth.jwt(), so the disposable environment must not
-- mask missing managed-auth privileges with a role workaround. The ledger still
-- grants the table owner narrowly scoped SELECT on auth.users for exact
-- invitation/email validation; no schema or function grant is needed here.

drop policy if exists projectceo_pi_table_owner_select on auth.users;
create policy projectceo_pi_table_owner_select
  on auth.users
  for select
  to pi_table_owner
  using (true);

do $guard$
begin
  if has_schema_privilege('pi_table_owner', 'auth', 'USAGE')
     or has_schema_privilege('pi_human_executor', 'auth', 'USAGE')
     or has_schema_privilege('pi_worker_executor', 'auth', 'USAGE') then
    raise exception 'AP1_AUTH_SCHEMA_COMPAT_GRANT_MUST_NOT_EXIST';
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
