-- RemHaOS Integration Gateway PR5: never expose provider connection metadata.
--
-- Additive projection hardening. Connection metadata is an internal persistence
-- seam and is intentionally not part of the browser-facing settings contract.

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
        'metadata', '{}'::jsonb,
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

commit;
