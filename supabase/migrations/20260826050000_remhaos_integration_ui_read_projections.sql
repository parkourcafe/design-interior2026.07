-- RemHaOS Integration Gateway PR5: team-safe project connection projection.
--
-- Additive only. The existing manage-only project projection remains the
-- command/settings contract; this read projection lets source reviewers see
-- already-bound connections without granting bind/unbind capability.

begin;

set local check_function_bodies = on;

create or replace function remhaos_integration_api.list_organization_connections(
  p_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context record;
begin
  select * into v_context
  from remhaos_integration._authorize_organization_human(
    p_organization_id,
    'manage_project_integrations'
  );

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'connectionId', connection.id,
        'providerCode', connection.provider_code,
        'status', connection.status,
        'displayLabel', connection.display_label,
        'metadata', connection.metadata,
        'tokenExpiresAt', connection.token_expires_at,
        'lastSuccessfulSyncAt', connection.last_successful_sync_at,
        'createdBy', connection.created_by,
        'createdAt', connection.created_at,
        'updatedAt', connection.updated_at,
        'projectsUsing', (
          select count(*)::integer
          from remhaos_integration.project_connections project_binding
          where project_binding.organization_id = connection.organization_id
            and project_binding.connection_id = connection.id
            and project_binding.unbound_at is null
        )
      )
      order by connection.updated_at desc, connection.id
    )
    from remhaos_integration.connections connection
    where connection.organization_id = v_context.organization_id
  ), '[]'::jsonb);
end
$function$;

alter function remhaos_integration_api.list_organization_connections(uuid)
  owner to pi_table_owner;

create function remhaos_integration_api.list_team_project_connections(
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context record;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    p_project_id,
    'review_source'
  );

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'projectConnectionId', binding.id,
        'connectionId', binding.connection_id,
        'providerCode', connection.provider_code,
        'status', connection.status,
        'displayLabel', connection.display_label,
        'allowedCapabilities', binding.allowed_capabilities,
        'syncPolicy', binding.sync_policy,
        'clientVisibility', binding.client_visibility,
        'boundBy', binding.bound_by,
        'boundAt', binding.bound_at,
        'unboundAt', binding.unbound_at,
        'lastSuccessfulSyncAt', connection.last_successful_sync_at
      )
      order by binding.bound_at desc, binding.id
    )
    from remhaos_integration.project_connections binding
    join remhaos_integration.connections connection
      on connection.organization_id = binding.organization_id
     and connection.id = binding.connection_id
    where binding.organization_id = v_context.organization_id
      and binding.project_id = p_project_id
      and binding.unbound_at is null
  ), '[]'::jsonb);
end
$function$;

alter function remhaos_integration_api.list_team_project_connections(uuid)
  owner to pi_table_owner;

revoke all on function
  remhaos_integration_api.list_team_project_connections(uuid)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
grant execute on function
  remhaos_integration_api.list_team_project_connections(uuid)
  to authenticated;

commit;
