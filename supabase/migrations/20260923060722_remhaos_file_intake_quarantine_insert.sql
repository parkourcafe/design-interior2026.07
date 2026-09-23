-- WP-32: real request-bound intake could create metadata but not quarantine bytes.
-- INSERT only. This does not authorize reads, overwrites, clean scans or R1 objects.
begin;

create function remhaos_integration_api.can_insert_file_intake_quarantine_object(
  p_bucket text,
  p_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_intake remhaos_integration.file_intakes%rowtype;
  v_context record;
begin
  if p_bucket is distinct from 'client-uploads' or p_name is null
     or length(p_name) > 600
     or p_name !~ '^project-intelligence/ru/[0-9a-f-]{36}/[0-9a-f-]{36}/quarantine/[0-9a-f-]{36}/[0-9a-f]{64}/[a-z-]+\.[a-z]+$' then
    return false;
  end if;
  select * into v_intake
  from remhaos_integration.file_intakes intake
  where intake.organization_id = split_part(p_name, '/', 3)::uuid
    and intake.project_id = split_part(p_name, '/', 4)::uuid
    and intake.intake_id = split_part(p_name, '/', 6)::uuid;
  if not found or v_intake.status <> 'requested'
     or v_intake.quarantine_object_key <> p_name
     or not remhaos_integration._is_legacy_file_intake(
       v_intake.organization_id, v_intake.project_id, v_intake.intake_id
     ) then
    return false;
  end if;
  select * into v_context
  from projectceo_foundation._authorize_project_human(v_intake.project_id, 'register_source');
  return v_context.organization_id = v_intake.organization_id
    and v_context.actor_user_id = v_intake.created_by_user_id
    and exists (
      select 1 from projectceo_foundation.project_packages package
      where package.organization_id = v_intake.organization_id
        and package.project_id = v_intake.project_id
        and package.id = v_intake.package_id
        and package.kind = 'project_root' and package.status = 'active'
    );
exception
  when invalid_text_representation or sqlstate 'P1101' or sqlstate 'P1102'
    or sqlstate 'P1103' or sqlstate 'P1104' then
    return false;
end
$function$;

alter function remhaos_integration_api.can_insert_file_intake_quarantine_object(text, text)
  owner to pi_table_owner;
revoke all on function remhaos_integration_api.can_insert_file_intake_quarantine_object(text, text)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
grant execute on function remhaos_integration_api.can_insert_file_intake_quarantine_object(text, text)
  to authenticated;

-- Managed Storage exists in Supabase but not in the base DB4/DB5 prelude.
do $storage_policy$
begin
  if to_regclass('storage.objects') is not null then
    execute $policy$
      create policy file_intake_quarantine_insert
      on storage.objects for insert to authenticated
      with check (
        remhaos_integration_api.can_insert_file_intake_quarantine_object(bucket_id, name)
      )
    $policy$;
  end if;
end
$storage_policy$;

commit;
