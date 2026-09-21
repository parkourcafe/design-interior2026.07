begin;

-- WP-14 / S-MIG #2 / DB4-57.
--
-- Historical production objects are intentionally absent from a clean
-- bootstrap. Keep this remediation additive: when an adopted legacy object
-- is not present, this migration is a no-op for that object.
create or replace function projectceo_platform.apply_legacy_adopted_hardening()
returns void
language plpgsql
set search_path = pg_catalog
as $hardening$
declare
  v_function_name text;
  v_function_identity text;
  v_function_oid regprocedure;
begin
  if to_regclass('public.rate_limits') is not null then
    alter table public.rate_limits enable row level security;
    drop policy if exists rate_limits_deny_anon_authenticated on public.rate_limits;
    create policy rate_limits_deny_anon_authenticated
      on public.rate_limits
      as restrictive
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;

  -- The observed production functions have not been reconstructed in the
  -- clean bootstrap and their argument lists are not a repository contract.
  -- Resolve every matching public overload from pg_proc, then re-resolve its
  -- catalog identity with to_regprocedure before revoking only anon EXECUTE.
  foreach v_function_name in array array[
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
    for v_function_identity in
      select routine.oid::regprocedure::text
      from pg_proc routine
      join pg_namespace namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'public'
        and routine.proname = v_function_name
        and routine.prokind = 'f'
        and routine.prosecdef
    loop
      v_function_oid := to_regprocedure(v_function_identity);
      if v_function_oid is not null then
        -- PostgreSQL grants EXECUTE to PUBLIC by default. Revoking only the
        -- anon role would leave its effective privilege intact, so remove the
        -- inherited grant and immediately preserve authenticated access.
        execute format('revoke execute on function %s from public, anon', v_function_oid);
        execute format('grant execute on function %s to authenticated', v_function_oid);
      end if;
    end loop;
  end loop;

  if to_regclass('public.project_facts') is not null then
    alter table public.project_facts enable row level security;
    alter table public.project_facts force row level security;
  end if;
end
$hardening$;

select projectceo_platform.apply_legacy_adopted_hardening();

revoke all on function projectceo_platform.apply_legacy_adopted_hardening()
  from public, anon, authenticated, service_role, pi_human_executor,
       pi_worker_executor;

commit;
