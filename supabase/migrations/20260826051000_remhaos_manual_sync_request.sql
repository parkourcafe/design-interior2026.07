-- RemHaOS Integration Gateway PR5: human-requested manual sync boundary.
--
-- Additive only. The worker-only enqueue RPC remains unchanged; this command
-- records a bounded manual selected-object request for an authorized owner.

begin;

set local check_function_bodies = on;

create function remhaos_integration_api.request_manual_integration_sync(
  p_project_id uuid,
  p_project_connection_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_binding remhaos_integration.project_connections%rowtype;
  v_connection remhaos_integration.connections%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_job_key text;
  v_replay jsonb;
  v_job remhaos_integration.sync_jobs%rowtype;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_foundation._authorize_project_human(
    p_project_id,
    'manage_project_integrations'
  );

  select * into v_binding
  from remhaos_integration.project_connections binding
  where binding.id = p_project_connection_id
    and binding.organization_id = v_context.organization_id
    and binding.project_id = p_project_id
    and binding.unbound_at is null
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"projectConnection"}'::jsonb
    );
  end if;

  if not v_binding.allowed_capabilities @> array['list_objects']::text[]
     or coalesce(v_binding.sync_policy ->> 'mode', '') <> 'manual' then
    perform remhaos_integration._raise(
      'P1211',
      'validation_failed',
      '{"field":"projectConnection","reason":"MANUAL_SELECTED_OBJECT_REQUIRED"}'::jsonb
    );
  end if;

  select * into v_connection
  from remhaos_integration.connections connection
  where connection.organization_id = v_context.organization_id
    and connection.id = v_binding.connection_id
    and connection.status in ('connected', 'degraded')
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"connection"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_job_key := encode(v_key_digest, 'hex');
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'actorId', v_context.actor_id,
      'projectId', p_project_id,
      'projectConnectionId', p_project_connection_id,
      'selectionMode', 'explicit_selected_object'
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_context.organization_id,
    p_project_id,
    'enqueue_integration_job',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  insert into remhaos_integration.sync_jobs (
    organization_id,
    project_id,
    connection_id,
    job_kind,
    idempotency_key,
    input_ref
  )
  values (
    v_context.organization_id,
    p_project_id,
    v_connection.id,
    'manual_selected_object_sync',
    v_job_key,
    '{"selectionMode":"explicit_selected_object"}'::jsonb
  )
  on conflict (organization_id, project_id, job_kind, idempotency_key)
  do update set id = remhaos_integration.sync_jobs.id
  returning * into v_job;

  v_result := jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'jobKind', v_job.job_kind,
    'selectionMode', 'explicit_selected_object'
  );

  return remhaos_integration._complete_command(
    v_context.organization_id,
    p_project_id,
    'enqueue_integration_job',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'integration_job_enqueued',
    v_job.status,
    jsonb_build_object(
      'providerCode', v_connection.provider_code,
      'reasonCode', 'manual_selected_object_sync'
    )
  );
end
$function$;

alter function remhaos_integration_api.request_manual_integration_sync(
  uuid, uuid, text
) owner to pi_table_owner;

revoke all on function
  remhaos_integration_api.request_manual_integration_sync(uuid, uuid, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;
grant execute on function
  remhaos_integration_api.request_manual_integration_sync(uuid, uuid, text)
  to authenticated;

commit;
