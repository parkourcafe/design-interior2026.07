-- Additive compatibility follow-up for PostgREST deployments that expose the
-- complete JWT only through request.jwt.claims and leave request.jwt.claim.sub
-- unset. No managed auth ACL or table access is required.

begin;

create or replace function project_intelligence._request_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    nullif(project_intelligence._request_jwt() ->> 'sub', '')::uuid
  )
$function$;

alter function project_intelligence._request_user_id() owner to pi_table_owner;

revoke all on function project_intelligence._request_user_id()
  from public, anon, authenticated, service_role;
grant execute on function project_intelligence._request_user_id()
  to pi_table_owner, pi_human_executor, pi_worker_executor;

do $guard$
begin
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
