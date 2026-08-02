-- Tighten the additive custom access-token hook so email_verified is never
-- carried into a fresh password/generic-email authentication event.

begin;

create or replace function public.projectceo_custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  authentication_method text := lower(coalesce(event ->> 'authentication_method', ''));
begin
  if authentication_method in ('otp', 'magiclink', 'invite', 'email/signup')
     or (authentication_method = 'token_refresh'
         and claims ->> 'email_verified' = 'true') then
    claims := jsonb_set(claims, '{email_verified}', 'true'::jsonb, true);
  else
    claims := claims - 'email_verified';
  end if;

  return jsonb_build_object('claims', claims);
end
$function$;

revoke all on function public.projectceo_custom_access_token_hook(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.projectceo_custom_access_token_hook(jsonb)
  to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

commit;
