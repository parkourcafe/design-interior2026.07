-- Custom access-token hook: password logins get email_verified from DB truth.
--
-- Основание: hosted-пилот 24.08.2026 (REMHAOS_AP1_PILOT_EVIDENCE_2026-08-24.md,
-- FIND-01). Hosted GoTrue не включает `email_verified` в access token при
-- password-логине (локальный стек включает), из-за чего identity-гейт
-- `P1102 identity_unverified` отвергал легитимные подтверждённые личности.
-- Метка в user_metadata лечением не является: её редактирует сам пользователь.
--
-- Решение: для `authentication_method = 'password'` хук ставит claim из
-- ПРАВДЫ БАЗЫ — `auth.users.email_confirmed_at`. Чтение auth.users здесь
-- легитимно: хук исполняется от `supabase_auth_admin` (владельца схемы auth)
-- и вызывается самим GoTrue, а не прикладными ролями. Остальное поведение
-- `20260802001000` сохранено без изменений: непарольные методы, кроме
-- разрешённых, по-прежнему лишаются claim'а; token_refresh сохраняет его
-- только если он уже был true.
--
-- Миграция additive: `create or replace function`, владелец и права
-- сохраняются (тот же приём, что `20260802001000`).

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
  v_email_confirmed boolean;
begin
  if authentication_method in ('otp', 'magiclink', 'invite', 'email/signup')
     or (authentication_method = 'token_refresh'
         and claims ->> 'email_verified' = 'true') then
    claims := jsonb_set(claims, '{email_verified}', 'true'::jsonb, true);
  elsif authentication_method = 'password' then
    -- Правда базы, а не редактируемые пользователем метаданные.
    select (u.email_confirmed_at is not null)
      into v_email_confirmed
      from auth.users u
      where u.id = (claims ->> 'sub')::uuid;
    if v_email_confirmed is true then
      claims := jsonb_set(claims, '{email_verified}', 'true'::jsonb, true);
    else
      claims := claims - 'email_verified';
    end if;
  else
    claims := claims - 'email_verified';
  end if;

  return jsonb_build_object('claims', claims);
end
$function$;

do $guard$
declare
  v_def text := pg_get_functiondef(
    'public.projectceo_custom_access_token_hook(jsonb)'::regprocedure
  );
begin
  if v_def !~ 'authentication_method = .password.' then
    raise exception 'AP1_HOOK_PASSWORD_BRANCH_MISSING';
  end if;
  if v_def !~ 'email_confirmed_at' then
    raise exception 'AP1_HOOK_DB_TRUTH_MISSING';
  end if;
end
$guard$;

commit;
