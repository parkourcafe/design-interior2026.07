-- ProjectCEO authorization compatibility for managed Supabase.
--
-- SECURITY DEFINER functions owned by pi_table_owner cannot resolve
-- auth.uid()/auth.jwt() on hosted Supabase: the managed auth schema is owned by
-- supabase_admin and the migration role cannot grant schema lookup to the
-- NOLOGIN table owner. Read the signed PostgREST request claims instead. The
-- request GUCs are populated by the authenticated gateway and are available to
-- the definer without granting access to auth tables or schemas.
--
-- This migration is additive and preserves all public function signatures.

begin;

set local check_function_bodies = on;

create or replace function project_intelligence._request_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;

create or replace function project_intelligence._request_jwt()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$function$;

alter function project_intelligence._request_user_id() owner to pi_table_owner;
alter function project_intelligence._request_jwt() owner to pi_table_owner;

revoke all on function project_intelligence._request_user_id() from public, anon,
  authenticated, service_role;
revoke all on function project_intelligence._request_jwt() from public, anon,
  authenticated, service_role;
grant execute on function project_intelligence._request_user_id()
  to pi_table_owner, pi_human_executor, pi_worker_executor;
grant execute on function project_intelligence._request_jwt()
  to pi_table_owner, pi_human_executor, pi_worker_executor;

-- Rewrite only Project Intelligence/ProjectCEO functions that depended on the
-- managed auth schema. pg_get_functiondef preserves each frozen signature and
-- body; CREATE OR REPLACE leaves the existing owner and grants unchanged.
do $rewrite$
declare
  item record;
  definition text;
begin
  for item in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (
      'project_intelligence',
      'projectceo_foundation',
      'projectceo_api',
      'projectceo_product',
      'projectceo_product_api',
      'projectceo_m4',
      'projectceo_m4_api'
    )
      and p.prokind = 'f'
      and (
        pg_get_functiondef(p.oid) like '%auth.uid()%' or
        pg_get_functiondef(p.oid) like '%auth.jwt()%'
      )
  loop
    definition := pg_get_functiondef(item.oid);
    definition := replace(
      definition,
      'auth.uid()',
      'project_intelligence._request_user_id()'
    );
    definition := replace(
      definition,
      'auth.jwt()',
      'project_intelligence._request_jwt()'
    );
    execute definition;
  end loop;
end
$rewrite$;

-- The two policies are evaluated as pi_human_executor/pi_table_owner during
-- protected operations, so they must use the same role-neutral actor source.
drop policy if exists organization_members_human_self
  on project_intelligence.organization_members;
create policy organization_members_human_self
on project_intelligence.organization_members
for select to pi_human_executor
using (user_id = project_intelligence._request_user_id());

drop policy if exists member_capabilities_human_self
  on project_intelligence.member_capabilities;
create policy member_capabilities_human_self
on project_intelligence.member_capabilities
for select to pi_human_executor
using (user_id = project_intelligence._request_user_id());

drop policy if exists projects_projectceo_enrollment_select on public.projects;
create policy projects_projectceo_enrollment_select
on public.projects
for select to pi_table_owner
using (designer_id = project_intelligence._request_user_id());

drop policy if exists projects_projectceo_enrollment_lock on public.projects;
create policy projects_projectceo_enrollment_lock
on public.projects
for update to pi_table_owner
using (designer_id = project_intelligence._request_user_id())
with check (designer_id = project_intelligence._request_user_id());

-- The historical auth grants remain immutable migration history. They are not
-- repeated here and are not an authorization mechanism; the product no longer
-- calls auth.uid()/auth.jwt() from the affected ProjectCEO functions. We do not
-- attempt to revoke managed-schema ACLs because postgres is not their owner on
-- hosted Supabase.

do $guard$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (
      'project_intelligence',
      'projectceo_foundation',
      'projectceo_api',
      'projectceo_product',
      'projectceo_product_api',
      'projectceo_m4',
      'projectceo_m4_api'
    )
      and p.prokind = 'f'
      and (
        pg_get_functiondef(p.oid) like '%auth.uid()%' or
        pg_get_functiondef(p.oid) like '%auth.jwt()%'
      )
  ) then
    raise exception 'PROJECTCEO_MANAGED_AUTH_REFERENCE_REMAINS';
  end if;

  if not has_function_privilege(
    'pi_table_owner',
    'project_intelligence._request_user_id()',
    'EXECUTE'
  ) or not has_function_privilege(
    'pi_human_executor',
    'project_intelligence._request_user_id()',
    'EXECUTE'
  ) then
    raise exception 'PROJECTCEO_REQUEST_ACTOR_HELPER_NOT_EXECUTABLE';
  end if;
end
$guard$;

commit;
