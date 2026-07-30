-- ArchiDom RU AP1 authenticated read surface.
--
-- This additive migration introduces one RPC-only schema for the disposable
-- authenticated pilot.  Private persistence schemas remain unexposed and
-- retain zero direct grants for runtime roles.  The read function derives the
-- actor, organization, effective project/package scope and capabilities from
-- auth.uid(); caller-controlled authorization attributes are not accepted.

begin;

set local check_function_bodies = on;

create schema projectceo_read_api authorization pi_table_owner;

revoke all on schema projectceo_read_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke create on schema projectceo_read_api from public;

alter default privileges for role pi_table_owner
  in schema projectceo_read_api
  revoke execute on functions
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- A request-bound HTTP retry obtains the latest state revision before every
-- attempt.  The accepted v0.1 release RPCs include that transport precondition
-- in request_digest, so an exact retry after a lost response conflicts with
-- its first command record.  AP1 uses distinct operation names and functions:
-- expected_state_revision is still enforced on first execution, but it is not
-- part of semantic identity.  The original functions and records stay intact.
alter table projectceo_product.command_records
  drop constraint command_records_operation_check;
alter table projectceo_product.command_records
  add constraint command_records_operation_check
  check (operation in (
    'append_decision_revision',
    'append_selection_revision',
    'append_system_decision_revision',
    'append_system_selection_revision',
    'append_price_observation',
    'create_approval_package',
    'submit_approval_package',
    'review_approval_package',
    'publish_project_baseline',
    'publish_production_package_version',
    'build_release_artifact',
    'distribute_release',
    'acknowledge_release',
    'distribute_release_request_bound',
    'acknowledge_release_request_bound',
    'approve_no_change',
    'submit_change_request',
    'calculate_change_impact',
    'review_change_impact',
    'define_milestone',
    'register_photo_evidence',
    'review_photo_evidence',
    'accept_milestone',
    'register_handover_document',
    'build_construction_handover'
  ));

create function projectceo_product_api.distribute_release_request_bound(
  project_id uuid,
  artifact_id text,
  recipient_user_id uuid,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_artifact projectceo_product.release_artifacts%rowtype;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_distribution projectceo_product.release_distributions%rowtype;
  v_outcome text := 'created';
  v_result jsonb;
begin
  perform projectceo_product._assert_text(
    artifact_id,
    'artifactId',
    160
  );
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  select * into v_artifact
  from projectceo_product.release_artifacts artifact
  where artifact.project_id = project_id
    and artifact.artifact_id = artifact_id;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"releaseArtifact"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    v_artifact.package_id,
    'distribute_release'
  );

  if not (
    exists (
      select 1
      from projectceo_foundation.project_memberships membership
      where membership.organization_id = v_context.organization_id
        and membership.project_id = project_id
        and membership.user_id = recipient_user_id
        and membership.status = 'active'
    )
    or exists (
      select 1
      from projectceo_foundation.package_memberships membership
      where membership.organization_id = v_context.organization_id
        and membership.project_id = project_id
        and membership.package_id = v_artifact.package_id
        and membership.user_id = recipient_user_id
        and membership.status = 'active'
    )
  ) then
    perform projectceo_product._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"RECIPIENT_SCOPE_REQUIRED"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'artifactId', artifact_id,
      'projectId', project_id,
      'recipientUserId', recipient_user_id
    )
  );

  select workflow.state_revision into v_state_revision
  from project_intelligence.project_workflows workflow
  where workflow.organization_id = v_context.organization_id
    and workflow.project_id = project_id
  for update;

  if exists (
    select 1
    from projectceo_product.command_records command
    where command.organization_id = v_context.organization_id
      and command.project_id = project_id
      and command.operation = 'distribute_release_request_bound'
      and command.key_digest = v_key_digest
      and (
        command.actor_type <> 'human'
        or command.actor_user_id is distinct from v_context.actor_user_id
      )
  ) then
    perform projectceo_product._raise(
      'P1103',
      'forbidden',
      '{"reason":"IDEMPOTENCY_ACTOR_MISMATCH"}'::jsonb
    );
  end if;

  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id,
    project_id,
    'distribute_release_request_bound',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    if not exists (
      select 1
      from projectceo_product.command_records command
      where command.organization_id = v_context.organization_id
        and command.project_id = project_id
        and command.operation = 'distribute_release_request_bound'
        and command.key_digest = v_key_digest
        and command.actor_type = 'human'
        and command.actor_user_id = v_context.actor_user_id
    ) then
      perform projectceo_product._raise(
        'P1103',
        'forbidden',
        '{"reason":"IDEMPOTENCY_ACTOR_MISMATCH"}'::jsonb
      );
    end if;
    return v_replay;
  end if;

  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select * into v_distribution
  from projectceo_product.release_distributions distribution
  where distribution.organization_id = v_context.organization_id
    and distribution.project_id = project_id
    and distribution.package_id = v_artifact.package_id
    and distribution.production_package_version_id =
      v_artifact.production_package_version_id
    and distribution.recipient_user_id = recipient_user_id
  for update;
  if found then
    v_outcome := 'existing_distribution';
  else
    insert into projectceo_product.release_distributions (
      organization_id,
      project_id,
      package_id,
      artifact_id,
      production_package_version_id,
      artifact_semantic_digest,
      recipient_user_id,
      distributed_by_user_id
    )
    values (
      v_context.organization_id,
      project_id,
      v_artifact.package_id,
      v_artifact.artifact_id,
      v_artifact.production_package_version_id,
      v_artifact.semantic_digest,
      recipient_user_id,
      v_context.actor_user_id
    )
    returning * into v_distribution;
  end if;

  v_result := jsonb_build_object(
    'artifactId', v_distribution.artifact_id,
    'distributionId', v_distribution.distribution_id,
    'kind', v_outcome,
    'packageId', v_distribution.package_id,
    'productionPackageVersionId',
      v_distribution.production_package_version_id,
    'recipientUserId', v_distribution.recipient_user_id
  );

  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'distribute_release_request_bound',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'release_distributed',
    jsonb_build_object(
      'artifact_id', v_distribution.artifact_id,
      'distribution_id', v_distribution.distribution_id,
      'outcome', v_outcome,
      'package_id', v_distribution.package_id,
      'production_package_version_id',
        v_distribution.production_package_version_id
    ),
    v_state_revision
  );
end
$function$;

create function projectceo_product_api.acknowledge_release_request_bound(
  project_id uuid,
  distribution_id uuid,
  expected_semantic_hash text,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_distribution projectceo_product.release_distributions%rowtype;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_expected_digest bytea;
  v_acknowledgement projectceo_product.release_acknowledgements%rowtype;
  v_result jsonb;
begin
  v_expected_digest := projectceo_product._assert_semantic_hash(
    expected_semantic_hash
  );
  perform projectceo_foundation._assert_state_revision(
    expected_state_revision
  );
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  select * into v_distribution
  from projectceo_product.release_distributions distribution
  where distribution.project_id = project_id
    and distribution.distribution_id = distribution_id;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"releaseDistribution"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    v_distribution.package_id,
    'acknowledge_release'
  );
  if v_context.actor_user_id <> v_distribution.recipient_user_id then
    perform projectceo_product._raise(
      'P1103',
      'forbidden',
      '{"reason":"DISTRIBUTION_RECIPIENT_REQUIRED"}'::jsonb
    );
  end if;
  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'distributionId', distribution_id,
      'expectedSemanticHash', expected_semantic_hash,
      'projectId', project_id
    )
  );

  select workflow.state_revision into v_state_revision
  from project_intelligence.project_workflows workflow
  where workflow.organization_id = v_context.organization_id
    and workflow.project_id = project_id
  for update;

  if exists (
    select 1
    from projectceo_product.command_records command
    where command.organization_id = v_context.organization_id
      and command.project_id = project_id
      and command.operation = 'acknowledge_release_request_bound'
      and command.key_digest = v_key_digest
      and (
        command.actor_type <> 'human'
        or command.actor_user_id is distinct from v_context.actor_user_id
      )
  ) then
    perform projectceo_product._raise(
      'P1103',
      'forbidden',
      '{"reason":"IDEMPOTENCY_ACTOR_MISMATCH"}'::jsonb
    );
  end if;

  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id,
    project_id,
    'acknowledge_release_request_bound',
    v_key_digest,
    v_request_digest
  );
  if v_replay is not null then
    if not exists (
      select 1
      from projectceo_product.command_records command
      where command.organization_id = v_context.organization_id
        and command.project_id = project_id
        and command.operation = 'acknowledge_release_request_bound'
        and command.key_digest = v_key_digest
        and command.actor_type = 'human'
        and command.actor_user_id = v_context.actor_user_id
    ) then
      perform projectceo_product._raise(
        'P1103',
        'forbidden',
        '{"reason":"IDEMPOTENCY_ACTOR_MISMATCH"}'::jsonb
      );
    end if;
    return v_replay;
  end if;

  if v_expected_digest <> v_distribution.artifact_semantic_digest then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      '{"reason":"RELEASE_HASH_STALE"}'::jsonb
    );
  end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;
  if exists (
    select 1
    from projectceo_product.release_acknowledgements acknowledgement
    where acknowledgement.organization_id = v_context.organization_id
      and acknowledgement.project_id = project_id
      and acknowledgement.distribution_id = distribution_id
  ) then
    perform projectceo_product._raise(
      'P1109',
      'scope_conflict',
      '{"reason":"RELEASE_ALREADY_ACKNOWLEDGED"}'::jsonb
    );
  end if;

  insert into projectceo_product.release_acknowledgements (
    organization_id,
    project_id,
    distribution_id,
    package_id,
    production_package_version_id,
    artifact_semantic_digest,
    acknowledged_by_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    distribution_id,
    v_distribution.package_id,
    v_distribution.production_package_version_id,
    v_distribution.artifact_semantic_digest,
    v_context.actor_user_id
  )
  returning * into v_acknowledgement;

  v_result := jsonb_build_object(
    'acknowledgedAt', v_acknowledgement.acknowledged_at,
    'acknowledgementId', v_acknowledgement.acknowledgement_id,
    'distributionId', v_acknowledgement.distribution_id,
    'packageId', v_acknowledgement.package_id,
    'productionPackageVersionId',
      v_acknowledgement.production_package_version_id,
    'semanticHash',
      'sha256:' || encode(
        v_acknowledgement.artifact_semantic_digest,
        'hex'
      )
  );

  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'acknowledge_release_request_bound',
    v_key_digest,
    v_request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'release_acknowledged',
    jsonb_build_object(
      'acknowledgement_id', v_acknowledgement.acknowledgement_id,
      'distribution_id', v_acknowledgement.distribution_id,
      'package_id', v_acknowledgement.package_id,
      'production_package_version_id',
        v_acknowledgement.production_package_version_id,
      'semantic_hash',
        'sha256:' || encode(
          v_acknowledgement.artifact_semantic_digest,
          'hex'
        )
    ),
    v_state_revision
  );
end
$function$;

-- M4 keeps its frozen human command helper and operation names.  These narrow
-- probes run before the accepted mutation RPCs.  On an exact lost-response
-- retry they reconstruct the original digest from the stored resulting
-- revision; on first execution they return null and the accepted RPC remains
-- the sole writer.  Each public probe derives its target package from domain
-- state and re-authorizes the human before looking at the command record.
create function projectceo_m4._request_bound_human_replay_or_null(
  p_project_id uuid,
  p_package_id uuid,
  p_capability text,
  p_operation text,
  p_idempotency_key text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_actor_user_id uuid;
  v_key_digest bytea;
  v_expected_request_digest bytea;
  v_record projectceo_product.command_records%rowtype;
begin
  if (p_operation, p_capability) not in (
    ('submit_change_request', 'create_change'),
    ('review_change_impact', 'review_change_impact'),
    ('register_photo_evidence', 'upload_photo_evidence'),
    ('review_photo_evidence', 'review_milestone'),
    ('accept_milestone', 'review_milestone')
  ) then
    perform projectceo_product._raise(
      'P1112',
      'internal_error',
      '{"reason":"REQUEST_BOUND_REPLAY_OPERATION_DENIED"}'::jsonb
    );
  end if;

  select
    min(context.organization_id::text)::uuid,
    min(context.actor_user_id::text)::uuid
  into v_organization_id, v_actor_user_id
  from projectceo_foundation._authorize_package_human(
    p_project_id,
    p_package_id,
    p_capability
  ) context;

  perform projectceo_foundation._assert_idempotency_key(
    p_idempotency_key
  );
  if jsonb_typeof(p_request_payload) <> 'object' then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"requestPayload"}'::jsonb
    );
  end if;

  v_key_digest := project_intelligence._sha256_text(
    btrim(p_idempotency_key)
  );
  select * into v_record
  from projectceo_product.command_records record
  where record.organization_id = v_organization_id
    and record.project_id = p_project_id
    and record.operation = p_operation
    and record.key_digest = v_key_digest;
  if not found then return null; end if;

  if v_record.actor_type <> 'human'
     or v_record.actor_user_id is distinct from v_actor_user_id then
    perform projectceo_product._raise(
      'P1103',
      'forbidden',
      '{"reason":"IDEMPOTENCY_ACTOR_MISMATCH"}'::jsonb
    );
  end if;

  if v_record.resulting_state_revision < 1 then
    perform projectceo_product._raise(
      'P1112',
      'internal_error',
      '{"reason":"REQUEST_BOUND_REPLAY_REVISION_INVALID"}'::jsonb
    );
  end if;
  v_expected_request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'expectedStateRevision', v_record.resulting_state_revision - 1,
      'operation', p_operation,
      'packageId', p_package_id,
      'payload', p_request_payload,
      'projectId', p_project_id
    )
  );
  if v_record.request_digest <> v_expected_request_digest then
    perform projectceo_product._raise(
      'P1108',
      'idempotency_conflict',
      jsonb_build_object('operation', p_operation)
    );
  end if;

  return jsonb_build_object(
    'operation', p_operation,
    'replay', true,
    'stateRevision', v_record.resulting_state_revision,
    'result', v_record.logical_result
  );
end
$function$;

create function projectceo_m4_api.replay_submit_change_request(
  project_id uuid,
  package_id uuid,
  from_baseline_id text,
  proposed_baseline_id text,
  from_production_package_version_id text,
  reason text,
  delta_cost_rub bigint,
  delta_days integer,
  idempotency_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_reason text;
begin
  v_reason := projectceo_product._assert_text(reason, 'reason', 4000);
  if delta_cost_rub is null
     or delta_cost_rub not between -9007199254740991 and 9007199254740991
     or delta_days is null then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"CHANGE_DELTA_INVALID"}'::jsonb
    );
  end if;
  return projectceo_m4._request_bound_human_replay_or_null(
    project_id,
    package_id,
    'create_change',
    'submit_change_request',
    idempotency_key,
    jsonb_build_object(
      'deltaCostRub', delta_cost_rub,
      'deltaDays', delta_days,
      'fromBaselineId', from_baseline_id,
      'fromProductionPackageVersionId',
        from_production_package_version_id,
      'proposedBaselineId', proposed_baseline_id,
      'reason', v_reason
    )
  );
end
$function$;

create function projectceo_m4_api.replay_review_change_impact(
  project_id uuid,
  impact_run_id uuid,
  impact_id text,
  disposition text,
  reason text,
  idempotency_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_package_id uuid;
  v_reason text;
begin
  if disposition not in ('accepted', 'resolved', 'dismissed') then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"disposition"}'::jsonb
    );
  end if;
  v_reason := projectceo_product._assert_text(reason, 'reason', 4000);
  select impact.package_id into v_package_id
  from projectceo_m4.impacts impact
  where impact.project_id = project_id
    and impact.impact_run_id = impact_run_id
    and impact.impact_id = impact_id;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"impact"}'::jsonb
    );
  end if;
  return projectceo_m4._request_bound_human_replay_or_null(
    project_id,
    v_package_id,
    'review_change_impact',
    'review_change_impact',
    idempotency_key,
    jsonb_build_object(
      'disposition', disposition,
      'impactId', impact_id,
      'impactRunId', impact_run_id,
      'reason', v_reason
    )
  );
end
$function$;

create function projectceo_m4_api.replay_register_photo_evidence(
  project_id uuid,
  milestone_id uuid,
  area_node_id text,
  source_id text,
  source_revision_id text,
  captured_at timestamptz,
  note text,
  idempotency_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_package_id uuid;
  v_note text := nullif(btrim(coalesce(note, '')), '');
begin
  if v_note is not null and (v_note <> note or length(v_note) > 4000) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"note"}'::jsonb
    );
  end if;
  if captured_at is null
     or captured_at > statement_timestamp() + interval '5 minutes' then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"capturedAt"}'::jsonb
    );
  end if;
  select milestone.package_id into v_package_id
  from projectceo_m4.milestones milestone
  where milestone.project_id = project_id
    and milestone.milestone_id = milestone_id;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"milestone"}'::jsonb
    );
  end if;
  return projectceo_m4._request_bound_human_replay_or_null(
    project_id,
    v_package_id,
    'upload_photo_evidence',
    'register_photo_evidence',
    idempotency_key,
    jsonb_build_object(
      'areaNodeId', area_node_id,
      'capturedAt', captured_at,
      'milestoneId', milestone_id,
      'note', v_note,
      'sourceId', source_id,
      'sourceRevisionId', source_revision_id
    )
  );
end
$function$;

create function projectceo_m4_api.replay_review_photo_evidence(
  project_id uuid,
  photo_evidence_id uuid,
  decision text,
  reason text,
  idempotency_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_package_id uuid;
  v_reason text;
begin
  if decision not in ('accepted', 'rejected') then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"decision"}'::jsonb
    );
  end if;
  v_reason := projectceo_product._assert_text(reason, 'reason', 4000);
  select photo.package_id into v_package_id
  from projectceo_m4.photo_evidence photo
  where photo.project_id = project_id
    and photo.photo_evidence_id = photo_evidence_id;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"photoEvidence"}'::jsonb
    );
  end if;
  return projectceo_m4._request_bound_human_replay_or_null(
    project_id,
    v_package_id,
    'review_milestone',
    'review_photo_evidence',
    idempotency_key,
    jsonb_build_object(
      'decision', decision,
      'photoEvidenceId', photo_evidence_id,
      'reason', v_reason
    )
  );
end
$function$;

create function projectceo_m4_api.replay_accept_milestone(
  project_id uuid,
  milestone_id uuid,
  idempotency_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_package_id uuid;
begin
  select milestone.package_id into v_package_id
  from projectceo_m4.milestones milestone
  where milestone.project_id = project_id
    and milestone.milestone_id = milestone_id;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"milestone"}'::jsonb
    );
  end if;
  return projectceo_m4._request_bound_human_replay_or_null(
    project_id,
    v_package_id,
    'review_milestone',
    'accept_milestone',
    idempotency_key,
    jsonb_build_object('milestoneId', milestone_id)
  );
end
$function$;

create function projectceo_read_api.get_project_workspace_read(
  project_id uuid,
  package_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_actor_user_id uuid;
  v_project_wide boolean;
  v_organization_count integer;
  v_state_revision bigint;
  v_can_distribute boolean := false;
  v_can_review_source boolean := false;
  v_data jsonb;
begin
  if package_id is null then
    select
      context.organization_id,
      context.actor_user_id,
      true
    into
      v_organization_id,
      v_actor_user_id,
      v_project_wide
    from projectceo_foundation._authorize_project_human(
      project_id,
      'view_project'
    ) context;
  else
    select
      count(distinct context.organization_id),
      min(context.organization_id::text)::uuid,
      min(context.actor_user_id::text)::uuid,
      bool_or(context.project_wide)
    into
      v_organization_count,
      v_organization_id,
      v_actor_user_id,
      v_project_wide
    from projectceo_foundation._authorize_package_human(
      project_id,
      package_id,
      'view_project'
    ) context;

    if v_organization_count <> 1 then
      perform projectceo_foundation._raise(
        'P1109',
        'scope_conflict',
        '{"reason":"AMBIGUOUS_PACKAGE_SCOPE"}'::jsonb
      );
    end if;
  end if;

  select workflow.state_revision
  into v_state_revision
  from project_intelligence.project_workflows workflow
  where workflow.organization_id = v_organization_id
    and workflow.project_id = project_id;

  if not found then
    perform projectceo_foundation._raise(
      'P1104',
      'not_found',
      '{"entity":"project"}'::jsonb
    );
  end if;

  v_can_distribute := exists (
    select 1
    from projectceo_foundation.project_member_capabilities capability
    where capability.organization_id = v_organization_id
      and capability.project_id = project_id
      and capability.user_id = v_actor_user_id
      and capability.capability = 'distribute_release'
  ) or (
    package_id is not null
    and exists (
      select 1
      from projectceo_foundation.package_member_capabilities capability
      where capability.organization_id = v_organization_id
        and capability.project_id = project_id
        and capability.package_id = package_id
        and capability.user_id = v_actor_user_id
        and capability.capability = 'distribute_release'
    )
  );

  v_can_review_source := exists (
    select 1
    from projectceo_foundation.project_member_capabilities capability
    where capability.organization_id = v_organization_id
      and capability.project_id = project_id
      and capability.user_id = v_actor_user_id
      and capability.capability = 'review_source'
  ) or (
    package_id is not null
    and exists (
      select 1
      from projectceo_foundation.package_member_capabilities capability
      where capability.organization_id = v_organization_id
        and capability.project_id = project_id
        and capability.package_id = package_id
        and capability.user_id = v_actor_user_id
        and capability.capability = 'review_source'
    )
  );

  select jsonb_build_object(
    'approvalPackages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'createdAt', approval.created_at,
        'id', approval.approval_package_id,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'entityId', item.entity_id,
            'ordinal', item.ordinal,
            'revisionId', item.revision_id,
            'targetKind', item.target_kind
          ) order by item.ordinal)
          from projectceo_product.approval_package_items item
          where item.organization_id = approval.organization_id
            and item.project_id = approval.project_id
            and item.approval_package_id = approval.approval_package_id
        ), '[]'::jsonb),
        'packageId', approval.package_id,
        'status', coalesce((
          select event.to_status
          from projectceo_product.approval_package_events event
          where event.organization_id = approval.organization_id
            and event.project_id = approval.project_id
            and event.approval_package_id = approval.approval_package_id
          order by event.sequence_no desc
          limit 1
        ), 'draft')
      ) order by approval.created_at desc)
      from projectceo_product.approval_packages approval
      where approval.organization_id = v_organization_id
        and approval.project_id = project_id
        and (package_id is null or approval.package_id = package_id)
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'areaNodeId', descriptor.area_node_id,
        'claimStatus', revision.claim_status,
        'evidence', coalesce((
          select jsonb_agg(jsonb_build_object(
            'evidenceLinkId', evidence.evidence_link_id,
            'evidenceVersionId', evidence.evidence_version_id,
            'fragmentId', evidence.fragment_id,
            'locator', fragment.locator,
            'locatorKind', fragment.locator_kind,
            'sourceId', evidence.source_id,
            'sourceRevisionId', evidence.source_revision_id
          ) order by evidence.ordinal)
          from projectceo_product.revision_evidence_refs evidence
          join project_intelligence.source_fragments fragment
            on fragment.organization_id = evidence.organization_id
           and fragment.project_id = evidence.project_id
           and fragment.fragment_id = evidence.fragment_id
          where evidence.organization_id = descriptor.organization_id
            and evidence.project_id = descriptor.project_id
            and evidence.claim_revision_id = descriptor.revision_id
        ), '[]'::jsonb),
        'id', descriptor.node_id,
        'packageId', descriptor.package_id,
        'resolution', revision.payload ->> 'resolution',
        'revisionHistory', coalesce((
          select jsonb_agg(jsonb_build_object(
            'reason', history.reason,
            'revisionId', history.revision_id,
            'revisionNo', history.revision_no,
            'status', case
              when history.revision_id = descriptor.revision_id
                then 'current'
              else 'superseded'
            end
          ) order by history.revision_no desc)
          from projectceo_product.claim_revision_descriptors history
          where history.organization_id = descriptor.organization_id
            and history.project_id = descriptor.project_id
            and history.node_id = descriptor.node_id
            and history.kind = 'decision'
        ), '[]'::jsonb),
        'revisionId', descriptor.revision_id,
        'revisionNo', descriptor.revision_no,
        'reviewStatus', coalesce((
          select case
            when event.to_status = 'rejected' then 'change_requested'
            else event.to_status
          end
          from projectceo_product.approval_package_items item
          join lateral (
            select approval_event.to_status
            from projectceo_product.approval_package_events approval_event
            where approval_event.organization_id = item.organization_id
              and approval_event.project_id = item.project_id
              and approval_event.approval_package_id = item.approval_package_id
            order by approval_event.sequence_no desc
            limit 1
          ) event on true
          where item.organization_id = descriptor.organization_id
            and item.project_id = descriptor.project_id
            and item.revision_id = descriptor.revision_id
          order by case event.to_status
            when 'approved' then 5
            when 'change_requested' then 4
            when 'rejected' then 3
            when 'submitted' then 2
            else 1
          end desc
          limit 1
        ), case
          when descriptor.review_status = 'submitted' then 'submitted'
          else 'submitted'
        end),
        'title', revision.title
      ) order by descriptor.package_id::text, descriptor.node_id collate "C")
      from projectceo_product.claim_revision_descriptors descriptor
      join project_intelligence.graph_nodes node
        on node.organization_id = descriptor.organization_id
       and node.project_id = descriptor.project_id
       and node.node_id = descriptor.node_id
       and node.current_revision_id = descriptor.revision_id
      join project_intelligence.graph_node_revisions revision
        on revision.organization_id = descriptor.organization_id
       and revision.project_id = descriptor.project_id
       and revision.node_id = descriptor.node_id
       and revision.revision_id = descriptor.revision_id
      where descriptor.organization_id = v_organization_id
        and descriptor.project_id = project_id
        and descriptor.kind = 'decision'
        and (package_id is null or descriptor.package_id = package_id)
    ), '[]'::jsonb),
    'distributionSummary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'acknowledgementCount', summary.acknowledgement_count,
        'packageId', summary.package_id,
        'productionPackageVersionId', summary.production_package_version_id,
        'recipientCount', summary.recipient_count
      ) order by summary.package_id::text,
                 summary.production_package_version_id collate "C")
      from (
        select
          distribution.package_id,
          distribution.production_package_version_id,
          count(*)::bigint recipient_count,
          count(acknowledgement.acknowledgement_id)::bigint
            acknowledgement_count
        from projectceo_product.release_distributions distribution
        left join projectceo_product.release_acknowledgements acknowledgement
          on acknowledgement.organization_id = distribution.organization_id
         and acknowledgement.project_id = distribution.project_id
         and acknowledgement.distribution_id = distribution.distribution_id
        where distribution.organization_id = v_organization_id
          and distribution.project_id = project_id
          and (package_id is null or distribution.package_id = package_id)
        group by
          distribution.package_id,
          distribution.production_package_version_id
      ) summary
    ), '[]'::jsonb),
    'executionPackages', coalesce((
      select jsonb_agg(
        projectceo_m4_api.get_execution_delivery(project_id, package.id)
        order by package.stable_key collate "C"
      )
      from projectceo_foundation.project_packages package
      where package.organization_id = v_organization_id
        and package.project_id = project_id
        and package.status = 'active'
        and (package_id is null or package.id = package_id)
    ), '[]'::jsonb),
    'extensionStatus', jsonb_build_object(
      'distributionIds', 'recipient_bound',
      'privateSchemas', 'not_exposed',
      'sourceFilenames', 'sanitized_only',
      'workspaceRead', 'durable_ap1'
    ),
    'latestBaseline', (
      select jsonb_build_object(
        'graphVersionId', baseline.graph_version_id,
        'id', baseline.baseline_id,
        'previousBaselineId', baseline.previous_baseline_id,
        'publishedAt', baseline.published_at,
        'semanticHash',
          'sha256:' || encode(baseline.semantic_digest, 'hex'),
        'status', 'published',
        'versionNo', baseline.version_no
      )
      from projectceo_product.project_baselines baseline
      where baseline.organization_id = v_organization_id
        and baseline.project_id = project_id
        and (
          package_id is null
          or exists (
            select 1
            from projectceo_product.project_baseline_packages binding
            where binding.organization_id = baseline.organization_id
              and binding.project_id = baseline.project_id
              and binding.baseline_id = baseline.baseline_id
              and binding.package_id = package_id
          )
        )
      order by baseline.version_no desc
      limit 1
    ),
    'noChangeTerminals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'approvedAt', terminal.approved_at,
        'baselineId', terminal.baseline_id,
        'packageId', terminal.package_id,
        'productionPackageVersionId',
          terminal.production_package_version_id,
        'status', 'approved_no_change'
      ) order by terminal.approved_at desc)
      from projectceo_product.no_change_terminals terminal
      where terminal.organization_id = v_organization_id
        and terminal.project_id = project_id
        and (package_id is null or terminal.package_id = package_id)
    ), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', package.id,
        'kind', package.kind,
        'name', package.name,
        'parentPackageId', package.parent_package_id,
        'stableKey', package.stable_key,
        'status', package.status
      ) order by package.stable_key collate "C")
      from projectceo_foundation.project_packages package
      where package.organization_id = v_organization_id
        and package.project_id = project_id
        and (package_id is null or package.id = package_id)
    ), '[]'::jsonb),
    'packageVersions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'baselineId', version.baseline_id,
        'exactRevisionRefs',
          version.semantic_content -> 'exactRevisionRefs',
        'id', version.production_package_version_id,
        'packageId', version.package_id,
        'previousVersionId', version.previous_version_id,
        'publishedAt', version.published_at,
        'semanticHash',
          'sha256:' || encode(version.semantic_digest, 'hex'),
        'status', 'published',
        'versionNo', version.version_no
      ) order by version.package_id::text, version.version_no)
      from projectceo_product.production_package_versions version
      where version.organization_id = v_organization_id
        and version.project_id = project_id
        and (package_id is null or version.package_id = package_id)
    ), '[]'::jsonb),
    'projectMetadata', (
      select jsonb_build_object(
        'areaM2', case
          when jsonb_typeof(project.passport #> '{object,area_m2}') = 'number'
            and (project.passport #>> '{object,area_m2}')::numeric
              between 0 and 9007199254740991
            and trunc((project.passport #>> '{object,area_m2}')::numeric) =
              (project.passport #>> '{object,area_m2}')::numeric
            then (project.passport #>> '{object,area_m2}')::bigint
          when jsonb_typeof(project.passport -> 'area_m2') = 'number'
            and (project.passport ->> 'area_m2')::numeric
              between 0 and 9007199254740991
            and trunc((project.passport ->> 'area_m2')::numeric) =
              (project.passport ->> 'area_m2')::numeric
            then (project.passport ->> 'area_m2')::bigint
          else 0
        end,
        'location', coalesce(
          nullif(btrim(project.passport #>> '{object,city}'), ''),
          nullif(btrim(project.passport ->> 'city'), ''),
          nullif(btrim(project.passport ->> 'location'), ''),
          ''
        ),
        'model', 'full_project',
        'name', coalesce(
          nullif(btrim(project.passport ->> 'project_name'), ''),
          nullif(btrim(project.passport ->> 'name'), ''),
          nullif(btrim(project.client_name), ''),
          'Project ' || left(project.id::text, 8)
        )
      )
      from public.projects project
      where project.id = project_id
    ),
    'recipientDistributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'acknowledged', acknowledgement.acknowledgement_id is not null,
        'acknowledgedAt', acknowledgement.acknowledged_at,
        'artifactId', distribution.artifact_id,
        'distributedAt', distribution.distributed_at,
        'distributionId', distribution.distribution_id,
        'packageId', distribution.package_id,
        'productionPackageVersionId',
          distribution.production_package_version_id,
        'semanticHash',
          'sha256:' || encode(distribution.artifact_semantic_digest, 'hex')
      ) order by distribution.distributed_at desc)
      from projectceo_product.release_distributions distribution
      left join projectceo_product.release_acknowledgements acknowledgement
        on acknowledgement.organization_id = distribution.organization_id
       and acknowledgement.project_id = distribution.project_id
       and acknowledgement.distribution_id = distribution.distribution_id
      where distribution.organization_id = v_organization_id
        and distribution.project_id = project_id
        and distribution.recipient_user_id = v_actor_user_id
        and (package_id is null or distribution.package_id = package_id)
    ), '[]'::jsonb),
    'releaseArtifacts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'artifactId', artifact.artifact_id,
        'format', artifact.format,
        'id', artifact.artifact_id,
        'packageId', artifact.package_id,
        'productionPackageVersionId',
          artifact.production_package_version_id,
        'semanticHash',
          'sha256:' || encode(artifact.semantic_digest, 'hex')
      ) order by artifact.created_at desc)
      from projectceo_product.release_artifacts artifact
      where artifact.organization_id = v_organization_id
        and artifact.project_id = project_id
        and (package_id is null or artifact.package_id = package_id)
    ), '[]'::jsonb),
    'releaseRecipients', case
      when not v_can_distribute then '[]'::jsonb
      else coalesce((
        select jsonb_agg(recipient order by recipient ->> 'userId')
        from (
          select distinct jsonb_build_object(
            'packageId', null,
            'role', membership.role,
            'scope', 'project',
            'userId', membership.user_id
          ) recipient
          from projectceo_foundation.project_memberships membership
          where membership.organization_id = v_organization_id
            and membership.project_id = project_id
            and membership.status = 'active'
          union
          select distinct jsonb_build_object(
            'packageId', membership.package_id,
            'role', membership.role,
            'scope', 'package',
            'userId', membership.user_id
          ) recipient
          from projectceo_foundation.package_memberships membership
          where membership.organization_id = v_organization_id
            and membership.project_id = project_id
            and membership.status = 'active'
            and (package_id is null or membership.package_id = package_id)
        ) recipients
      ), '[]'::jsonb)
    end,
    'reviewQueue', case
      when not v_can_review_source then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          'claimStatus', revision.claim_status,
          'kind', node.kind,
          'nodeId', node.node_id,
          'origin', revision.origin,
          'revisionId', revision.revision_id,
          'title', revision.title
        ) order by node.stable_key collate "C")
        from project_intelligence.graph_nodes node
        join project_intelligence.graph_node_revisions revision
          on revision.organization_id = node.organization_id
         and revision.project_id = node.project_id
         and revision.node_id = node.node_id
         and revision.revision_id = node.current_revision_id
        where node.organization_id = v_organization_id
          and node.project_id = project_id
          and not exists (
            select 1
            from project_intelligence.human_reviews review
            where review.organization_id = revision.organization_id
              and review.project_id = revision.project_id
              and review.target_revision_id = revision.revision_id
          )
          and (
            package_id is null
            or exists (
              select 1
              from projectceo_product.claim_revision_descriptors descriptor
              where descriptor.organization_id = node.organization_id
                and descriptor.project_id = node.project_id
                and descriptor.revision_id = revision.revision_id
                and descriptor.package_id = package_id
            )
            or exists (
              select 1
              from project_intelligence.evidence_links evidence
              join project_intelligence.source_fragments fragment
                on fragment.organization_id = evidence.organization_id
               and fragment.project_id = evidence.project_id
               and fragment.fragment_id = evidence.source_fragment_id
              join projectceo_foundation.source_protected_metadata metadata
                on metadata.organization_id = fragment.organization_id
               and metadata.project_id = fragment.project_id
               and metadata.source_id = fragment.source_id
              where evidence.organization_id = node.organization_id
                and evidence.project_id = node.project_id
                and evidence.node_revision_id = revision.revision_id
                and metadata.package_id = package_id
            )
            or exists (
              select 1
              from projectceo_foundation.source_protected_metadata metadata
              where metadata.organization_id = node.organization_id
                and metadata.project_id = node.project_id
                and metadata.source_id = revision.payload ->> 'sourceId'
                and metadata.package_id = package_id
            )
          )
      ), '[]'::jsonb)
    end,
    'selections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'area', coalesce(area_revision.title, descriptor.area_node_id),
        'areaNodeId', descriptor.area_node_id,
        'claimStatus', revision.claim_status,
        'decisionRevisionId', descriptor.decision_revision_id,
        'evidence', coalesce((
          select jsonb_agg(jsonb_build_object(
            'evidenceLinkId', evidence.evidence_link_id,
            'evidenceVersionId', evidence.evidence_version_id,
            'fragmentId', evidence.fragment_id,
            'locator', fragment.locator,
            'locatorKind', fragment.locator_kind,
            'sourceId', evidence.source_id,
            'sourceRevisionId', evidence.source_revision_id
          ) order by evidence.ordinal)
          from projectceo_product.revision_evidence_refs evidence
          join project_intelligence.source_fragments fragment
            on fragment.organization_id = evidence.organization_id
           and fragment.project_id = evidence.project_id
           and fragment.fragment_id = evidence.fragment_id
          where evidence.organization_id = descriptor.organization_id
            and evidence.project_id = descriptor.project_id
            and evidence.claim_revision_id = descriptor.revision_id
        ), '[]'::jsonb),
        'id', descriptor.node_id,
        'packageId', descriptor.package_id,
        'priceObservation', (
          select jsonb_build_object(
            'amountRub', observation.amount_rub,
            'checkedAt', observation.observed_at,
            'sourceId', observation.source_id,
            'sourceRevisionId', observation.source_revision_id
          )
          from projectceo_product.price_observations observation
          where observation.organization_id = descriptor.organization_id
            and observation.project_id = descriptor.project_id
            and observation.selection_revision_id = descriptor.revision_id
          order by observation.observed_at desc
          limit 1
        ),
        'revisionHistory', coalesce((
          select jsonb_agg(jsonb_build_object(
            'reason', history.reason,
            'revisionId', history.revision_id,
            'revisionNo', history.revision_no,
            'status', case
              when history.revision_id = descriptor.revision_id
                then 'current'
              else 'superseded'
            end
          ) order by history.revision_no desc)
          from projectceo_product.claim_revision_descriptors history
          where history.organization_id = descriptor.organization_id
            and history.project_id = descriptor.project_id
            and history.node_id = descriptor.node_id
            and history.kind = 'selection'
        ), '[]'::jsonb),
        'revisionId', descriptor.revision_id,
        'revisionNo', descriptor.revision_no,
        'reviewStatus', coalesce((
          select event.to_status
          from projectceo_product.approval_package_items item
          join lateral (
            select approval_event.to_status
            from projectceo_product.approval_package_events approval_event
            where approval_event.organization_id = item.organization_id
              and approval_event.project_id = item.project_id
              and approval_event.approval_package_id = item.approval_package_id
            order by approval_event.sequence_no desc
            limit 1
          ) event on true
          where item.organization_id = descriptor.organization_id
            and item.project_id = descriptor.project_id
            and item.revision_id = descriptor.revision_id
          order by case event.to_status
            when 'approved' then 5
            when 'change_requested' then 4
            when 'rejected' then 3
            when 'submitted' then 2
            else 1
          end desc
          limit 1
        ), descriptor.review_status),
        'specification', revision.payload -> 'specification',
        'title', revision.title
      ) order by descriptor.package_id::text, descriptor.node_id collate "C")
      from projectceo_product.claim_revision_descriptors descriptor
      join project_intelligence.graph_nodes node
        on node.organization_id = descriptor.organization_id
       and node.project_id = descriptor.project_id
       and node.node_id = descriptor.node_id
       and node.current_revision_id = descriptor.revision_id
      join project_intelligence.graph_node_revisions revision
        on revision.organization_id = descriptor.organization_id
       and revision.project_id = descriptor.project_id
       and revision.node_id = descriptor.node_id
       and revision.revision_id = descriptor.revision_id
      left join project_intelligence.graph_nodes area
        on area.organization_id = descriptor.organization_id
       and area.project_id = descriptor.project_id
       and area.node_id = descriptor.area_node_id
      left join project_intelligence.graph_node_revisions area_revision
        on area_revision.organization_id = area.organization_id
       and area_revision.project_id = area.project_id
       and area_revision.node_id = area.node_id
       and area_revision.revision_id = area.current_revision_id
      where descriptor.organization_id = v_organization_id
        and descriptor.project_id = project_id
        and descriptor.kind = 'selection'
        and (package_id is null or descriptor.package_id = package_id)
    ), '[]'::jsonb),
    'sourceStats', (
      select jsonb_build_object(
        'duplicateGroups', (
          select count(*)
          from (
            select grouped_inventory.checksum
            from projectceo_foundation.source_inventory_records grouped_inventory
            where grouped_inventory.organization_id = v_organization_id
              and grouped_inventory.project_id = project_id
              and grouped_inventory.checksum is not null
              and (
                package_id is null
                or grouped_inventory.package_id = package_id
              )
            group by grouped_inventory.checksum
            having count(*) > 1
          ) duplicate_groups
        ),
        'materializedRecords', count(*) filter (
          where inventory.availability = 'materialized'
        ),
        'physicalRecords', count(*),
        'placeholders', count(*) filter (
          where inventory.availability = 'placeholder'
        ),
        'quarantinedGroups', count(distinct inventory.checksum) filter (
          where inventory.semantic_conflict
        ),
        'reviewQueue', count(*) filter (
          where inventory.availability = 'materialized'
            and not exists (
              select 1
              from project_intelligence.human_reviews review
              where review.organization_id = inventory.organization_id
                and review.project_id = inventory.project_id
                and review.target_revision_id = inventory.source_revision_id
            )
        ),
        'uniqueBlobs', count(distinct inventory.checksum)
          filter (where inventory.checksum is not null)
      )
      from projectceo_foundation.source_inventory_records inventory
      where inventory.organization_id = v_organization_id
        and inventory.project_id = project_id
        and (package_id is null or inventory.package_id = package_id)
    ),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'availability', inventory.availability,
        'checksum', case
          when inventory.checksum is null then null
          else encode(inventory.checksum, 'hex')
        end,
        'disciplineKey', inventory.discipline_key,
        'documentStatus', inventory.document_status,
        'floorKey', inventory.floor_key,
        'id', inventory.physical_record_id,
        'kind', source.kind,
        'logicalSourceId', inventory.logical_source_id,
        'mediaType', metadata.media_type,
        'packageId', inventory.package_id,
        'reviewStatus', case review.decision
          when 'confirmed' then 'confirmed'
          when 'rejected' then 'rejected'
          else 'pending'
        end,
        'reviewTargetRevisionId', inventory.source_revision_id,
        'sanitizedName', inventory.sanitized_name,
        'semanticConflict', inventory.semantic_conflict,
        'sizeBytes', inventory.size_bytes,
        'sourceRevisionId', inventory.source_revision_id,
        'sourceRole', metadata.source_role,
        'zoneKey', inventory.zone_key
      ) order by inventory.floor_key collate "C",
                 inventory.zone_key collate "C",
                 inventory.discipline_key collate "C",
                 inventory.sanitized_name collate "C")
      from projectceo_foundation.source_inventory_records inventory
      left join project_intelligence.sources source
        on source.organization_id = inventory.organization_id
       and source.project_id = inventory.project_id
       and source.source_id = inventory.logical_source_id
      left join projectceo_foundation.source_protected_metadata metadata
        on metadata.organization_id = inventory.organization_id
       and metadata.project_id = inventory.project_id
       and metadata.source_id = inventory.logical_source_id
      left join project_intelligence.human_reviews review
        on review.organization_id = inventory.organization_id
       and review.project_id = inventory.project_id
       and review.target_revision_id = inventory.source_revision_id
      where inventory.organization_id = v_organization_id
        and inventory.project_id = project_id
        and (package_id is null or inventory.package_id = package_id)
    ), '[]'::jsonb),
    'unresolvedImpactReviewCount', (
      select count(*)
      from projectceo_m4.impacts impact
      join projectceo_m4.impact_runs run
        on run.organization_id = impact.organization_id
       and run.project_id = impact.project_id
       and run.impact_run_id = impact.impact_run_id
      where impact.organization_id = v_organization_id
        and impact.project_id = project_id
        and (package_id is null or run.package_id = package_id)
        and not exists (
          select 1
          from projectceo_m4.impact_reviews review
          where review.organization_id = impact.organization_id
            and review.project_id = impact.project_id
            and review.impact_run_id = impact.impact_run_id
            and review.impact_id = impact.impact_id
        )
    )
  ) into v_data;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-authenticated-read/0.1',
    'data', v_data,
    'error', null,
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'scope', jsonb_build_object(
      'accessScope', case
        when package_id is null or v_project_wide then 'project'
        else 'package'
      end,
      'actorUserId', v_actor_user_id,
      'organizationId', v_organization_id,
      'packageId', package_id,
      'projectId', project_id
    ),
    'stateRevision', v_state_revision
  );
end
$function$;

-- Compatibility bridge: legacy callers keep the frozen foundation envelope,
-- but distribution identifiers are now recipient-bound instead of project-
-- visible.  Aggregate counts are available only on the AP1 read contract.
create or replace function projectceo_api.get_project_delivery(
  project_id uuid,
  package_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_read jsonb;
  v_data jsonb;
  v_acknowledgements jsonb;
begin
  v_read := projectceo_read_api.get_project_workspace_read(
    project_id,
    package_id
  );
  v_data := v_read -> 'data';

  select coalesce(jsonb_agg(jsonb_build_object(
    'acknowledged', true,
    'packageId', summary -> 'packageId',
    'productionPackageVersionId',
      summary -> 'productionPackageVersionId'
  )), '[]'::jsonb)
  into v_acknowledgements
  from jsonb_array_elements(
    coalesce(v_data -> 'distributionSummary', '[]'::jsonb)
  ) summary
  cross join lateral generate_series(
    1,
    coalesce((summary ->> 'acknowledgementCount')::integer, 0)
  ) acknowledged_ordinal;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-foundation/0.1',
    'requestId', v_read ->> 'requestId',
    'data', jsonb_build_object(
      'acknowledgements', v_acknowledgements,
      'distributions', coalesce(
        v_data -> 'recipientDistributions',
        '[]'::jsonb
      ),
      'extensionStatus', v_data -> 'extensionStatus',
      'latestBaseline', v_data -> 'latestBaseline',
      'noChangeTerminals', v_data -> 'noChangeTerminals',
      'package', case
        when package_id is null then null
        else (
          select package
          from jsonb_array_elements(v_data -> 'packages') package
          where package ->> 'id' = package_id::text
          limit 1
        )
      end,
      'packageVersions', v_data -> 'packageVersions',
      'projectId', project_id,
      'releaseArtifacts', v_data -> 'releaseArtifacts',
      'unresolvedImpactReviewCount',
        v_data -> 'unresolvedImpactReviewCount'
    ),
    'error', null
  );
end
$function$;

alter function projectceo_read_api.get_project_workspace_read(uuid, uuid)
  owner to pi_table_owner;
alter function projectceo_api.get_project_delivery(uuid, uuid)
  owner to pi_table_owner;
alter function projectceo_product_api.distribute_release_request_bound(
  uuid,
  text,
  uuid,
  bigint,
  text
) owner to pi_table_owner;
alter function projectceo_product_api.acknowledge_release_request_bound(
  uuid,
  uuid,
  text,
  bigint,
  text
) owner to pi_table_owner;
alter function projectceo_m4._request_bound_human_replay_or_null(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) owner to pi_table_owner;
alter function projectceo_m4_api.replay_submit_change_request(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  integer,
  text
) owner to pi_table_owner;
alter function projectceo_m4_api.replay_review_change_impact(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) owner to pi_table_owner;
alter function projectceo_m4_api.replay_register_photo_evidence(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  text,
  text
) owner to pi_table_owner;
alter function projectceo_m4_api.replay_review_photo_evidence(
  uuid,
  uuid,
  text,
  text,
  text
) owner to pi_table_owner;
alter function projectceo_m4_api.replay_accept_milestone(
  uuid,
  uuid,
  text
) owner to pi_table_owner;

revoke all on all functions in schema projectceo_read_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on function projectceo_api.get_project_delivery(uuid, uuid)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on function
  projectceo_product_api.distribute_release_request_bound(
    uuid,
    text,
    uuid,
    bigint,
    text
  ),
  projectceo_product_api.acknowledge_release_request_bound(
    uuid,
    uuid,
    text,
    bigint,
    text
  )
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on function projectceo_m4._request_bound_human_replay_or_null(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on function
  projectceo_m4_api.replay_submit_change_request(
    uuid,
    uuid,
    text,
    text,
    text,
    text,
    bigint,
    integer,
    text
  ),
  projectceo_m4_api.replay_review_change_impact(
    uuid,
    uuid,
    text,
    text,
    text,
    text
  ),
  projectceo_m4_api.replay_register_photo_evidence(
    uuid,
    uuid,
    text,
    text,
    text,
    timestamptz,
    text,
    text
  ),
  projectceo_m4_api.replay_review_photo_evidence(
    uuid,
    uuid,
    text,
    text,
    text
  ),
  projectceo_m4_api.replay_accept_milestone(uuid, uuid, text)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant usage on schema projectceo_read_api to authenticated;
grant execute on function
  projectceo_read_api.get_project_workspace_read(uuid, uuid),
  projectceo_api.get_project_delivery(uuid, uuid),
  projectceo_product_api.distribute_release_request_bound(
    uuid,
    text,
    uuid,
    bigint,
    text
  ),
  projectceo_product_api.acknowledge_release_request_bound(
    uuid,
    uuid,
    text,
    bigint,
    text
  ),
  projectceo_m4_api.replay_submit_change_request(
    uuid,
    uuid,
    text,
    text,
    text,
    text,
    bigint,
    integer,
    text
  ),
  projectceo_m4_api.replay_review_change_impact(
    uuid,
    uuid,
    text,
    text,
    text,
    text
  ),
  projectceo_m4_api.replay_register_photo_evidence(
    uuid,
    uuid,
    text,
    text,
    text,
    timestamptz,
    text,
    text
  ),
  projectceo_m4_api.replay_review_photo_evidence(
    uuid,
    uuid,
    text,
    text,
    text
  ),
  projectceo_m4_api.replay_accept_milestone(
    uuid,
    uuid,
    text
  )
  to authenticated;

commit;
