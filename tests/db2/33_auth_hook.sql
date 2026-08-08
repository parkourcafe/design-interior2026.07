\set ON_ERROR_STOP on

do $assert_auth_hook$
declare
  otp_claims jsonb;
  password_claims jsonb;
  generic_email_claims jsonb;
  refresh_claims jsonb;
begin
  select public.projectceo_custom_access_token_hook(
    '{"claims":{"email":"architect@example.test"},"authentication_method":"otp"}'::jsonb
  ) -> 'claims' into otp_claims;
  if otp_claims ->> 'email_verified' <> 'true' then
    raise exception 'DB2_AUTH_HOOK_OTP_CLAIM_MISSING';
  end if;

  select public.projectceo_custom_access_token_hook(
    '{"claims":{"email":"architect@example.test"},"authentication_method":"password"}'::jsonb
  ) -> 'claims' into password_claims;
  if password_claims ? 'email_verified' then
    raise exception 'DB2_AUTH_HOOK_PASSWORD_CLAIM_PRESENT';
  end if;

  select public.projectceo_custom_access_token_hook(
    '{"claims":{"email":"architect@example.test","email_verified":true},"authentication_method":"password"}'::jsonb
  ) -> 'claims' into password_claims;
  if password_claims ? 'email_verified' then
    raise exception 'DB2_AUTH_HOOK_PASSWORD_EXISTING_CLAIM_PRESENT';
  end if;

  select public.projectceo_custom_access_token_hook(
    '{"claims":{"email":"architect@example.test"},"authentication_method":"email"}'::jsonb
  ) -> 'claims' into generic_email_claims;
  if generic_email_claims ? 'email_verified' then
    raise exception 'DB2_AUTH_HOOK_GENERIC_EMAIL_CLAIM_PRESENT';
  end if;

  select public.projectceo_custom_access_token_hook(
    '{"claims":{"email":"architect@example.test","email_verified":true},"authentication_method":"token_refresh"}'::jsonb
  ) -> 'claims' into refresh_claims;
  if refresh_claims ->> 'email_verified' <> 'true' then
    raise exception 'DB2_AUTH_HOOK_REFRESH_CLAIM_LOST';
  end if;

  raise notice 'DB2_AUTH_HOOK_ASSERTIONS_OK';
end
$assert_auth_hook$;
