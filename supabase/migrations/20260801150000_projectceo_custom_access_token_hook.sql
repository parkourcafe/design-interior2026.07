-- Additive Supabase Auth hook contract for the hosted request-claims adapter.
--
-- GoTrue's standard JWT does not expose a top-level email_verified claim. The
-- Auth server does expose the signed authentication_method to this hook. Add
-- the claim only for the existing email-ownership methods, and retain it on
-- token refresh when it was issued by this hook previously. Generic email and
-- password authentication never receives the claim.

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
     or claims ->> 'email_verified' = 'true' then
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
