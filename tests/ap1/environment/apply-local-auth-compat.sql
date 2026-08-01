\set ON_ERROR_STOP on

-- ProjectCEO SECURITY DEFINER functions resolve the actor from signed request
-- claims, not auth.uid()/auth.jwt(). The disposable environment intentionally
-- models hosted Supabase: pi_* roles must not inherit or query managed auth.
drop policy if exists projectceo_pi_table_owner_select on auth.users;
revoke all on table auth.users from pi_table_owner, pi_human_executor,
  pi_worker_executor;
revoke usage on schema auth from pi_table_owner, pi_human_executor,
  pi_worker_executor;

do $guard$
begin
  if has_schema_privilege('pi_table_owner', 'auth', 'USAGE')
     or has_schema_privilege('pi_human_executor', 'auth', 'USAGE')
     or has_schema_privilege('pi_worker_executor', 'auth', 'USAGE') then
    raise exception 'AP1_AUTH_SCHEMA_COMPAT_GRANT_MUST_NOT_EXIST';
  end if;
  if exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.grantee = 'pi_table_owner'
      and privilege.table_schema = 'auth'
  ) or has_table_privilege('pi_table_owner', 'auth.users', 'SELECT') then
    raise exception 'AP1_AUTH_TABLE_PRIVILEGE_SCOPE_INVALID';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'auth'
      and policy.tablename = 'users'
  ) then
    raise exception 'AP1_AUTH_USERS_POLICY_SCOPE_INVALID';
  end if;
end
$guard$;
