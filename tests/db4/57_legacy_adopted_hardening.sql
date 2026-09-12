\set ON_ERROR_STOP on

-- DB4-57 / S-MIG #2. First prove the migration function is harmless on the
-- clean bootstrap, where historical production-only objects do not exist.
select projectceo_platform.apply_legacy_adopted_hardening();
select projectceo_platform.apply_legacy_adopted_hardening();

create table public.rate_limits (
  id bigint generated always as identity primary key,
  key text not null,
  created_at timestamptz not null default statement_timestamp()
);

create table public.project_facts (
  id bigint generated always as identity primary key,
  project_id uuid not null,
  fact_type text not null
);

do $legacy_rpc_stubs$
declare
  v_name text;
begin
  foreach v_name in array array[
    'adopt_legacy_m1_workflow',
    'approve_project_override',
    'authorize_proposal_revision',
    'complete_m1_human_review',
    'get_or_create_m1_proposal_draft',
    'issue_proposal_revision',
    'persist_m1_proposal_draft_steps',
    'reserve_m1_risk_rerun',
    'reserve_m1_risk_retry',
    'review_project_fact',
    'save_and_persist_m1_proposal_draft'
  ] loop
    execute format(
      'create function public.%I(p_project_id uuid) returns void language sql security definer as %L',
      v_name,
      'select null::void'
    );
    execute format('grant execute on function public.%I(uuid) to anon, authenticated', v_name);
  end loop;
end
$legacy_rpc_stubs$;

select projectceo_platform.apply_legacy_adopted_hardening();

do $legacy_adopted_contract$
declare
  v_name text;
  v_policy record;
begin
  select policyname, permissive, roles, cmd, qual, with_check
    into v_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'rate_limits'
    and policyname = 'rate_limits_deny_anon_authenticated';

  if v_policy.policyname is null
     or v_policy.permissive <> 'RESTRICTIVE'
     or v_policy.roles <> array['anon', 'authenticated']::name[]
     or v_policy.cmd <> 'ALL'
     or v_policy.qual <> 'false'
     or v_policy.with_check <> 'false' then
    raise exception 'DB4_LEGACY_ADOPTED_RATE_LIMITS_POLICY:%', row_to_json(v_policy);
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'rate_limits'
      and relation.relrowsecurity
  ) then
    raise exception 'DB4_LEGACY_ADOPTED_RATE_LIMITS_RLS_NOT_ENABLED';
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'project_facts'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) then
    raise exception 'DB4_LEGACY_ADOPTED_PROJECT_FACTS_RLS_NOT_FORCED';
  end if;

  foreach v_name in array array[
    'adopt_legacy_m1_workflow',
    'approve_project_override',
    'authorize_proposal_revision',
    'complete_m1_human_review',
    'get_or_create_m1_proposal_draft',
    'issue_proposal_revision',
    'persist_m1_proposal_draft_steps',
    'reserve_m1_risk_rerun',
    'reserve_m1_risk_retry',
    'review_project_fact',
    'save_and_persist_m1_proposal_draft'
  ] loop
    if has_function_privilege('anon', format('public.%I(uuid)', v_name), 'EXECUTE') then
      raise exception 'DB4_LEGACY_ADOPTED_ANON_RPC_GRANT:%', v_name;
    end if;
    if not has_function_privilege('authenticated', format('public.%I(uuid)', v_name), 'EXECUTE') then
      raise exception 'DB4_LEGACY_ADOPTED_AUTHENTICATED_RPC_REVOKED:%', v_name;
    end if;
  end loop;

  if not has_function_privilege('anon', 'public.is_studio_member(uuid,uuid)', 'EXECUTE') then
    raise exception 'DB4_LEGACY_ADOPTED_IS_STUDIO_MEMBER_CHANGED';
  end if;

  if exists (
    select 1
    from unnest(array['public', 'anon', 'authenticated', 'service_role']) role_name
    where has_function_privilege(
      role_name,
      'projectceo_platform.apply_legacy_adopted_hardening()',
      'EXECUTE'
    )
  ) then
    raise exception 'DB4_LEGACY_ADOPTED_HARDENING_FUNCTION_EXPOSED';
  end if;
end
$legacy_adopted_contract$;

select 'DB4_LEGACY_ADOPTED_HARDENING_OK' as result;
