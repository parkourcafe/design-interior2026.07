-- RemHaOS Integration Gateway PR6: preserve evidence while superseding open
-- candidates when the same selected external object gets a new revision.

begin;

create or replace function remhaos_integration_api.create_import_candidate(
  p_project_id uuid,
  p_external_object_id uuid,
  p_source_kind text,
  p_target_kind text,
  p_internal_object_key text,
  p_server_sha256 text,
  p_scan_state text,
  p_provenance jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_object remhaos_integration.external_objects%rowtype;
  v_candidate remhaos_integration.import_candidates%rowtype;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_object
  from remhaos_integration.external_objects object
  where object.id = p_external_object_id
    and object.project_id = p_project_id
  for update;
  if not found then
    perform remhaos_integration._raise(
      'P1204',
      'not_found',
      '{"entity":"externalObject"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    remhaos_integration._assert_idempotency_key(p_idempotency_key)
  );
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'projectId', p_project_id,
      'externalObjectId', p_external_object_id,
      'sourceKind', p_source_kind,
      'targetKind', p_target_kind,
      'serverSha256', p_server_sha256
    )
  );
  v_replay := remhaos_integration._replay_or_null(
    v_object.organization_id,
    p_project_id,
    'create_import_candidate',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    return v_replay;
  end if;

  -- Serialize candidate creation per connection so two workers cannot both
  -- leave an open candidate after observing different external revisions.
  perform 1
  from remhaos_integration.project_connections binding
  where binding.id = v_object.project_connection_id
  for update;

  if v_object.external_revision is not null then
    update remhaos_integration.import_candidates candidate
    set status = 'superseded'
    where candidate.organization_id = v_object.organization_id
      and candidate.project_id = p_project_id
      and candidate.status in ('candidate', 'reviewing')
      and candidate.external_object_id in (
        select previous_object.id
        from remhaos_integration.external_objects previous_object
        where previous_object.project_connection_id = v_object.project_connection_id
          and previous_object.provider_object_hash = v_object.provider_object_hash
          and previous_object.external_revision is not null
          and previous_object.external_revision <> v_object.external_revision
      );
  end if;

  insert into remhaos_integration.import_candidates (
    organization_id,
    project_id,
    external_object_id,
    source_kind,
    target_kind,
    internal_object_key,
    server_sha256,
    scan_state,
    provenance
  )
  values (
    v_object.organization_id,
    p_project_id,
    p_external_object_id,
    p_source_kind,
    p_target_kind,
    remhaos_integration._assert_safe_text(
      p_internal_object_key,
      'internalObjectKey',
      512,
      false
    ),
    p_server_sha256,
    p_scan_state,
    remhaos_integration._assert_json_object(
      coalesce(p_provenance, '{}'::jsonb),
      'provenance'
    )
  )
  returning * into v_candidate;

  v_result := jsonb_build_object(
    'candidateId', v_candidate.id,
    'state', 'candidate',
    'exactExternalRevision', v_object.external_revision
  );
  return remhaos_integration._complete_command(
    v_object.organization_id,
    p_project_id,
    'create_import_candidate',
    v_key_digest,
    v_request_digest,
    'system',
    'system:integration-worker',
    null,
    v_result,
    'import_candidate_created',
    'candidate',
    jsonb_build_object(
      'sourceKind', v_candidate.source_kind,
      'revisionSupersession', v_object.external_revision is not null
    )
  );
end
$function$;

commit;
