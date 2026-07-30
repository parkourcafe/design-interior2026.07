-- ProjectCEO RU thin M4 commands and package-scoped delivery projection.

begin;

set local check_function_bodies = on;

create function projectceo_m4._human_command_context(
  p_project_id uuid,
  p_package_id uuid,
  p_capability text,
  p_operation text,
  p_expected_state_revision bigint,
  p_idempotency_key text,
  p_request_payload jsonb
)
returns table (
  organization_id uuid,
  actor_user_id uuid,
  actor_id text,
  state_revision bigint,
  key_digest bytea,
  request_digest bytea,
  replay jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  select distinct
    context.organization_id,
    context.actor_user_id,
    context.actor_id
  into organization_id, actor_user_id, actor_id
  from projectceo_foundation._authorize_package_human(
    p_project_id,
    p_package_id,
    p_capability
  ) context;

  perform projectceo_foundation._assert_state_revision(
    p_expected_state_revision
  );
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

  key_digest := project_intelligence._sha256_text(
    btrim(p_idempotency_key)
  );
  request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'expectedStateRevision', p_expected_state_revision,
      'operation', p_operation,
      'packageId', p_package_id,
      'payload', p_request_payload,
      'projectId', p_project_id
    )
  );

  select pw.state_revision into state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = organization_id
    and pw.project_id = p_project_id
  for update;

  replay := projectceo_product._replay_or_null(
    organization_id,
    p_project_id,
    p_operation,
    key_digest,
    request_digest
  );
  if replay is null and state_revision <> p_expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', state_revision)
    );
  end if;
  return next;
end
$function$;

create function projectceo_m4._worker_command_context(
  p_project_id uuid,
  p_package_id uuid,
  p_operation text,
  p_expected_state_revision bigint,
  p_idempotency_key text,
  p_request_payload jsonb
)
returns table (
  organization_id uuid,
  actor_id text,
  state_revision bigint,
  key_digest bytea,
  request_digest bytea,
  replay jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  organization_id := projectceo_product._system_context(p_project_id);
  actor_id := 'system:projectceo-m4';
  perform projectceo_foundation._assert_state_revision(
    p_expected_state_revision
  );
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
  if not exists (
    select 1
    from projectceo_foundation.project_packages pp
    where pp.organization_id = organization_id
      and pp.project_id = p_project_id
      and pp.id = p_package_id
      and pp.status = 'active'
  ) then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"package"}'::jsonb
    );
  end if;

  key_digest := project_intelligence._sha256_text(
    btrim(p_idempotency_key)
  );
  request_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'expectedStateRevision', p_expected_state_revision,
      'operation', p_operation,
      'packageId', p_package_id,
      'payload', p_request_payload,
      'projectId', p_project_id
    )
  );

  select pw.state_revision into state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = organization_id
    and pw.project_id = p_project_id
  for update;

  replay := projectceo_product._replay_or_null(
    organization_id,
    p_project_id,
    p_operation,
    key_digest,
    request_digest
  );
  if replay is null and state_revision <> p_expected_state_revision then
    perform projectceo_product._raise(
      'P1107',
      'stale_state',
      jsonb_build_object('currentStateRevision', state_revision)
    );
  end if;
  return next;
end
$function$;

create function projectceo_m4._actor_initiator_role(
  p_organization_id uuid,
  p_project_id uuid,
  p_package_id uuid,
  p_actor_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_role text;
begin
  select pm.role into v_role
  from projectceo_foundation.project_memberships pm
  where pm.organization_id = p_organization_id
    and pm.project_id = p_project_id
    and pm.user_id = p_actor_user_id
    and pm.status = 'active';
  if v_role is null then
    select pm.role into v_role
    from projectceo_foundation.package_memberships pm
    where pm.organization_id = p_organization_id
      and pm.project_id = p_project_id
      and pm.package_id = p_package_id
      and pm.user_id = p_actor_user_id
      and pm.status = 'active';
  end if;
  return case v_role
    when 'owner_lead' then 'owner'
    when 'client_approver' then 'client'
    when 'architect' then 'architect'
    when 'builder' then 'builder'
    else null
  end;
end
$function$;

create function projectceo_m4._materialized_source(
  p_organization_id uuid,
  p_project_id uuid,
  p_package_id uuid,
  p_source_id text,
  p_source_revision_id text,
  p_allowed_roles text[]
)
returns table (
  source_checksum bytea,
  storage_object_path text,
  source_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
begin
  return query
  select s.checksum, s.storage_object_path, metadata.source_role
  from project_intelligence.sources s
  join projectceo_foundation.source_protected_metadata metadata
    on metadata.organization_id = s.organization_id
   and metadata.project_id = s.project_id
   and metadata.source_id = s.source_id
   and metadata.package_id = p_package_id
   and metadata.source_role = any(p_allowed_roles)
  join projectceo_foundation.source_inventory_records inventory
    on inventory.organization_id = s.organization_id
   and inventory.project_id = s.project_id
   and inventory.package_id = p_package_id
   and inventory.logical_source_id = s.source_id
   and inventory.source_revision_id = p_source_revision_id
   and inventory.checksum = s.checksum
   and inventory.availability = 'materialized'
  join project_intelligence.graph_node_revisions revision
    on revision.organization_id = s.organization_id
   and revision.project_id = s.project_id
   and revision.revision_id = p_source_revision_id
  join project_intelligence.graph_nodes node
    on node.organization_id = revision.organization_id
   and node.project_id = revision.project_id
   and node.node_id = revision.node_id
   and node.kind = 'source'
  where s.organization_id = p_organization_id
    and s.project_id = p_project_id
    and s.source_id = p_source_id
    and s.storage_object_path is not null;
  if not found then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"EXACT_MATERIALIZED_SOURCE_REQUIRED"}'::jsonb
    );
  end if;
end
$function$;

create function projectceo_m4._assert_version_open(
  p_organization_id uuid,
  p_project_id uuid,
  p_package_id uuid,
  p_production_package_version_id text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from projectceo_m4.construction_handovers handover
    where handover.organization_id = p_organization_id
      and handover.project_id = p_project_id
      and handover.package_id = p_package_id
      and handover.production_package_version_id =
        p_production_package_version_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"HANDOVER_VERSION_CLOSED"}'::jsonb
    );
  end if;
end
$function$;

create function projectceo_m4_api.submit_change_request(
  project_id uuid,
  package_id uuid,
  from_baseline_id text,
  proposed_baseline_id text,
  from_production_package_version_id text,
  reason text,
  delta_cost_rub bigint,
  delta_days integer,
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
  v_reason text;
  v_initiator_role text;
  v_change_request_id uuid := extensions.gen_random_uuid();
  v_root_count bigint;
  v_result jsonb;
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

  select * into v_context
  from projectceo_m4._human_command_context(
    project_id,
    package_id,
    'create_change',
    'submit_change_request',
    expected_state_revision,
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
  if v_context.replay is not null then return v_context.replay; end if;

  v_initiator_role := projectceo_m4._actor_initiator_role(
    v_context.organization_id,
    project_id,
    package_id,
    v_context.actor_user_id
  );
  if v_initiator_role is null then
    perform projectceo_product._raise(
      'P1103',
      'forbidden',
      '{"reason":"INITIATOR_ROLE_REQUIRED"}'::jsonb
    );
  end if;

  if not exists (
    select 1
    from projectceo_product.project_baselines proposed
    join projectceo_product.project_baseline_packages proposed_package
      on proposed_package.organization_id = proposed.organization_id
     and proposed_package.project_id = proposed.project_id
     and proposed_package.baseline_id = proposed.baseline_id
     and proposed_package.package_id = package_id
    join projectceo_product.production_package_versions prior_version
      on prior_version.organization_id = proposed.organization_id
     and prior_version.project_id = proposed.project_id
     and prior_version.package_id = package_id
     and prior_version.baseline_id = from_baseline_id
     and prior_version.production_package_version_id =
       from_production_package_version_id
    where proposed.organization_id = v_context.organization_id
      and proposed.project_id = project_id
      and proposed.baseline_id = proposed_baseline_id
      and proposed.previous_baseline_id = from_baseline_id
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"CHANGE_BASELINE_LINEAGE_INVALID"}'::jsonb
    );
  end if;

  -- Thin P0 accepts revision replacement only. Added or removed decision and
  -- selection identities require an explicit later contract version.
  if exists (
    with from_refs as (
      select ref.target_kind, ref.entity_id
      from projectceo_product.project_baseline_refs ref
      where ref.organization_id = v_context.organization_id
        and ref.project_id = project_id
        and ref.baseline_id = from_baseline_id
        and ref.target_kind in (
          'decision_revision', 'selection_revision'
        )
    ), proposed_refs as (
      select ref.target_kind, ref.entity_id
      from projectceo_product.project_baseline_refs ref
      where ref.organization_id = v_context.organization_id
        and ref.project_id = project_id
        and ref.baseline_id = proposed_baseline_id
        and ref.target_kind in (
          'decision_revision', 'selection_revision'
        )
    )
    select 1
    from from_refs
    full join proposed_refs using (target_kind, entity_id)
    where from_refs.entity_id is null or proposed_refs.entity_id is null
  ) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"CHANGE_ROOT_SET_UNSUPPORTED"}'::jsonb
    );
  end if;

  if exists (
    select 1
    from projectceo_m4.change_requests existing
    where existing.organization_id = v_context.organization_id
      and existing.project_id = project_id
      and existing.package_id = package_id
      and existing.from_baseline_id = from_baseline_id
      and existing.proposed_baseline_id = proposed_baseline_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"CHANGE_TRANSITION_ALREADY_SUBMITTED"}'::jsonb
    );
  end if;

  insert into projectceo_m4.change_requests (
    organization_id,
    project_id,
    change_request_id,
    package_id,
    from_baseline_id,
    proposed_baseline_id,
    from_production_package_version_id,
    protected_reason,
    reason_digest,
    initiator_role,
    delta_cost_rub,
    delta_days,
    requested_by_user_id
  )
  values (
    v_context.organization_id,
    project_id,
    v_change_request_id,
    package_id,
    from_baseline_id,
    proposed_baseline_id,
    from_production_package_version_id,
    v_reason,
    project_intelligence._sha256_text(v_reason),
    v_initiator_role,
    delta_cost_rub,
    delta_days,
    v_context.actor_user_id
  );

  insert into projectceo_m4.change_request_roots (
    organization_id,
    project_id,
    change_request_id,
    package_id,
    from_baseline_id,
    proposed_baseline_id,
    target_kind,
    node_id,
    from_revision_id,
    to_revision_id
  )
  select
    v_context.organization_id,
    project_id,
    v_change_request_id,
    package_id,
    from_baseline_id,
    proposed_baseline_id,
    prior.target_kind,
    prior.entity_id,
    prior.revision_id,
    proposed.revision_id
  from projectceo_product.project_baseline_refs prior
  join projectceo_product.project_baseline_refs proposed
    on proposed.organization_id = prior.organization_id
   and proposed.project_id = prior.project_id
   and proposed.target_kind = prior.target_kind
   and proposed.entity_id = prior.entity_id
   and proposed.baseline_id = proposed_baseline_id
  where prior.organization_id = v_context.organization_id
    and prior.project_id = project_id
    and prior.baseline_id = from_baseline_id
    and prior.target_kind in ('decision_revision', 'selection_revision')
    and prior.revision_id <> proposed.revision_id
  order by prior.target_kind collate "C", prior.entity_id collate "C";
  get diagnostics v_root_count = row_count;
  if v_root_count = 0 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"NO_CHANGE_ROOTS"}'::jsonb
    );
  end if;

  v_result := jsonb_build_object(
    'deltaCostRub', delta_cost_rub,
    'deltaDays', delta_days,
    'fromBaselineId', from_baseline_id,
    'fromProductionPackageVersionId',
      from_production_package_version_id,
    'id', v_change_request_id,
    'initiatorRole', v_initiator_role,
    'packageId', package_id,
    'projectId', project_id,
    'proposedBaselineId', proposed_baseline_id,
    'reasonHash', 'sha256:' || encode(
      project_intelligence._sha256_text(v_reason),
      'hex'
    ),
    'rootCount', v_root_count,
    'status', 'submitted'
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'submit_change_request',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'change_request_submitted',
    jsonb_build_object(
      'change_request_id', v_change_request_id,
      'from_baseline_id', from_baseline_id,
      'proposed_baseline_id', proposed_baseline_id,
      'reason_digest', 'sha256:' || encode(
        project_intelligence._sha256_text(v_reason),
        'hex'
      ),
      'root_count', v_root_count
    ),
    v_context.state_revision
  );
end
$function$;

create function projectceo_m4_api.calculate_change_impact(
  project_id uuid,
  change_request_id uuid,
  max_depth integer,
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
  v_package_id uuid;
  v_target_baseline_id text;
  v_target_graph_version_id text;
  v_impact_run_id uuid := extensions.gen_random_uuid();
  v_algorithm jsonb;
  v_impacts jsonb;
  v_result_digest bytea;
  v_result jsonb;
begin
  if max_depth is null or max_depth < 1 or max_depth > 20 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"field":"maxDepth"}'::jsonb
    );
  end if;
  select cr.package_id, cr.proposed_baseline_id, pb.graph_version_id
  into v_package_id, v_target_baseline_id, v_target_graph_version_id
  from projectceo_m4.change_requests cr
  join projectceo_product.project_baselines pb
    on pb.organization_id = cr.organization_id
   and pb.project_id = cr.project_id
   and pb.baseline_id = cr.proposed_baseline_id
  where cr.project_id = project_id
    and cr.change_request_id = change_request_id;
  if not found then
    perform projectceo_product._raise(
      'P1104',
      'not_found',
      '{"entity":"changeRequest"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_m4._worker_command_context(
    project_id,
    v_package_id,
    'calculate_change_impact',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object(
      'changeRequestId', change_request_id,
      'maxDepth', max_depth
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;
  if exists (
    select 1
    from projectceo_m4.impact_runs ir
    where ir.organization_id = v_context.organization_id
      and ir.project_id = project_id
      and ir.change_request_id = change_request_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"IMPACT_ALREADY_CALCULATED"}'::jsonb
    );
  end if;

  v_algorithm := jsonb_build_object(
    'cyclePolicy', 'shortest_path_per_changed_root',
    'direction', 'reverse_dependency',
    'maxDepth', max_depth,
    'ordering', 'unicode_code_point',
    'propagatingRelations', jsonb_build_array(
      'depends_on', 'derived_from', 'satisfies', 'specified_by'
    ),
    'version', 'project-ceo-impact/0.2'
  );

  with recursive roots as (
    select
      root.node_id changed_node_id,
      root.to_revision_id changed_revision_id
    from projectceo_m4.change_request_roots root
    where root.organization_id = v_context.organization_id
      and root.project_id = project_id
      and root.change_request_id = change_request_id
  ), walk as (
    select
      root.changed_node_id,
      root.changed_revision_id,
      root.changed_node_id current_node_id,
      array[root.changed_node_id]::text[] node_path,
      array[]::text[] edge_path
    from roots root
    union all
    select
      walk.changed_node_id,
      walk.changed_revision_id,
      edge.from_node_id,
      walk.node_path || edge.from_node_id,
      walk.edge_path || edge.edge_id
    from walk
    join project_intelligence.version_edges version_edge
      on version_edge.organization_id = v_context.organization_id
     and version_edge.project_id = project_id
     and version_edge.version_id = v_target_graph_version_id
    join project_intelligence.graph_edges edge
      on edge.organization_id = version_edge.organization_id
     and edge.project_id = version_edge.project_id
     and edge.edge_id = version_edge.edge_id
     and edge.to_node_id = walk.current_node_id
     and edge.relation in (
       'depends_on', 'derived_from', 'specified_by', 'satisfies'
     )
    where cardinality(walk.edge_path) < max_depth
      and not edge.from_node_id = any(walk.node_path)
  ), ranked as (
    select
      walk.*,
      row_number() over (
        partition by walk.changed_node_id, walk.current_node_id
        order by
          cardinality(walk.edge_path),
          walk.node_path collate "C",
          walk.edge_path collate "C"
      ) path_rank
    from walk
    where walk.current_node_id <> walk.changed_node_id
  ), best as (
    select * from ranked where path_rank = 1
  ), shaped as (
    select jsonb_build_object(
      'changedNodeId', best.changed_node_id,
      'changedRevisionId', best.changed_revision_id,
      'distance', cardinality(best.edge_path),
      'edgePath', coalesce((
        select jsonb_agg(jsonb_build_object(
          'edgeId', edge.edge_id,
          'fromNodeId', edge.from_node_id,
          'relation', edge.relation,
          'stepNo', edge_ref.ordinality - 1,
          'toNodeId', edge.to_node_id
        ) order by edge_ref.ordinality)
        from unnest(best.edge_path) with ordinality
          edge_ref(edge_id, ordinality)
        join project_intelligence.graph_edges edge
          on edge.organization_id = v_context.organization_id
         and edge.project_id = project_id
         and edge.edge_id = edge_ref.edge_id
      ), '[]'::jsonb),
      'impactId', 'impact:' || substr(encode(
        project_intelligence._sha256_jsonb(jsonb_build_array(
          change_request_id,
          v_target_graph_version_id,
          best.changed_node_id,
          best.current_node_id,
          to_jsonb(best.node_path),
          to_jsonb(best.edge_path)
        )),
        'hex'
      ), 1, 32),
      'impactedNodeId', best.current_node_id,
      'impactedRevisionId', target.revision_id,
      'nodePath', to_jsonb(best.node_path)
    ) impact
    from best
    join project_intelligence.version_nodes target
      on target.organization_id = v_context.organization_id
     and target.project_id = project_id
     and target.version_id = v_target_graph_version_id
     and target.node_id = best.current_node_id
  )
  select coalesce(jsonb_agg(shaped.impact order by
    shaped.impact ->> 'changedNodeId' collate "C",
    (shaped.impact ->> 'distance')::integer,
    shaped.impact ->> 'impactedNodeId' collate "C"
  ), '[]'::jsonb)
  into v_impacts
  from shaped;

  if jsonb_array_length(v_impacts) > 5000 then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"IMPACT_RESULT_LIMIT_EXCEEDED"}'::jsonb
    );
  end if;
  v_result_digest := project_intelligence._sha256_jsonb(
    jsonb_build_object(
      'algorithm', v_algorithm,
      'changeRequestId', change_request_id,
      'impacts', v_impacts,
      'targetBaselineId', v_target_baseline_id,
      'targetGraphVersionId', v_target_graph_version_id
    )
  );

  insert into projectceo_m4.impact_runs (
    organization_id,
    project_id,
    impact_run_id,
    change_request_id,
    package_id,
    target_baseline_id,
    target_graph_version_id,
    max_depth,
    algorithm,
    result_digest,
    created_by_id
  ) values (
    v_context.organization_id,
    project_id,
    v_impact_run_id,
    change_request_id,
    v_package_id,
    v_target_baseline_id,
    v_target_graph_version_id,
    max_depth,
    v_algorithm,
    v_result_digest,
    v_context.actor_id
  );

  insert into projectceo_m4.impacts (
    organization_id,
    project_id,
    impact_id,
    impact_run_id,
    change_request_id,
    package_id,
    target_graph_version_id,
    changed_node_id,
    changed_revision_id,
    impacted_node_id,
    impacted_revision_id,
    distance,
    node_path
  )
  select
    v_context.organization_id,
    project_id,
    impact ->> 'impactId',
    v_impact_run_id,
    change_request_id,
    v_package_id,
    v_target_graph_version_id,
    impact ->> 'changedNodeId',
    impact ->> 'changedRevisionId',
    impact ->> 'impactedNodeId',
    impact ->> 'impactedRevisionId',
    (impact ->> 'distance')::integer,
    array(select jsonb_array_elements_text(impact -> 'nodePath'))
  from jsonb_array_elements(v_impacts) shaped(impact)
  order by impact ->> 'impactId' collate "C";

  insert into projectceo_m4.impact_path_steps (
    organization_id,
    project_id,
    impact_id,
    impact_run_id,
    package_id,
    target_graph_version_id,
    step_no,
    edge_id,
    relation,
    from_node_id,
    to_node_id
  )
  select
    v_context.organization_id,
    project_id,
    impact ->> 'impactId',
    v_impact_run_id,
    v_package_id,
    v_target_graph_version_id,
    (step ->> 'stepNo')::integer,
    step ->> 'edgeId',
    step ->> 'relation',
    step ->> 'fromNodeId',
    step ->> 'toNodeId'
  from jsonb_array_elements(v_impacts) shaped_impact(impact)
  cross join lateral jsonb_array_elements(impact -> 'edgePath')
    shaped_step(step)
  order by impact ->> 'impactId' collate "C",
           (step ->> 'stepNo')::integer;

  v_result := jsonb_build_object(
    'algorithm', v_algorithm,
    'changeRequestId', change_request_id,
    'id', v_impact_run_id,
    'impactCount', jsonb_array_length(v_impacts),
    'impacts', v_impacts,
    'packageId', v_package_id,
    'projectId', project_id,
    'resultHash', 'sha256:' || encode(v_result_digest, 'hex'),
    'targetBaselineId', v_target_baseline_id,
    'targetGraphVersionId', v_target_graph_version_id
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'calculate_change_impact',
    v_context.key_digest,
    v_context.request_digest,
    'system',
    v_context.actor_id,
    null,
    v_result,
    'change_impact_calculated',
    jsonb_build_object(
      'change_request_id', change_request_id,
      'impact_count', jsonb_array_length(v_impacts),
      'impact_run_id', v_impact_run_id,
      'max_depth', max_depth,
      'result_digest', 'sha256:' || encode(v_result_digest, 'hex')
    ),
    v_context.state_revision
  );
end
$function$;

create function projectceo_m4_api.review_change_impact(
  project_id uuid,
  impact_run_id uuid,
  impact_id text,
  disposition text,
  reason text,
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
  v_package_id uuid;
  v_target_graph_version_id text;
  v_reason text;
  v_review_id uuid := extensions.gen_random_uuid();
  v_all_reviewed boolean;
  v_result jsonb;
begin
  if disposition not in ('accepted', 'resolved', 'dismissed') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"disposition"}'::jsonb
    );
  end if;
  v_reason := projectceo_product._assert_text(reason, 'reason', 4000);
  select impact.package_id, impact.target_graph_version_id
  into v_package_id, v_target_graph_version_id
  from projectceo_m4.impacts impact
  where impact.project_id = project_id
    and impact.impact_run_id = impact_run_id
    and impact.impact_id = impact_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"impact"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_m4._human_command_context(
    project_id,
    v_package_id,
    'review_change_impact',
    'review_change_impact',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object(
      'disposition', disposition,
      'impactId', impact_id,
      'impactRunId', impact_run_id,
      'reason', v_reason
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;
  if exists (
    select 1
    from projectceo_m4.impact_reviews review
    where review.organization_id = v_context.organization_id
      and review.project_id = project_id
      and review.impact_run_id = impact_run_id
      and review.impact_id = impact_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"IMPACT_ALREADY_REVIEWED"}'::jsonb
    );
  end if;

  insert into projectceo_m4.impact_reviews (
    organization_id,
    project_id,
    impact_review_id,
    impact_run_id,
    impact_id,
    package_id,
    target_graph_version_id,
    disposition,
    protected_reason,
    reason_digest,
    reviewed_by_user_id
  ) values (
    v_context.organization_id,
    project_id,
    v_review_id,
    impact_run_id,
    impact_id,
    v_package_id,
    v_target_graph_version_id,
    disposition,
    v_reason,
    project_intelligence._sha256_text(v_reason),
    v_context.actor_user_id
  );

  select not exists (
    select 1
    from projectceo_m4.impacts impact
    where impact.organization_id = v_context.organization_id
      and impact.project_id = project_id
      and impact.impact_run_id = impact_run_id
      and not exists (
        select 1
        from projectceo_m4.impact_reviews review
        where review.organization_id = impact.organization_id
          and review.project_id = impact.project_id
          and review.impact_run_id = impact.impact_run_id
          and review.impact_id = impact.impact_id
      )
  ) into v_all_reviewed;

  v_result := jsonb_build_object(
    'allImpactsReviewed', v_all_reviewed,
    'disposition', disposition,
    'id', v_review_id,
    'impactId', impact_id,
    'impactRunId', impact_run_id,
    'reasonHash', 'sha256:' || encode(
      project_intelligence._sha256_text(v_reason), 'hex'
    ),
    'reviewedBy', jsonb_build_object(
      'actorId', v_context.actor_id,
      'actorType', 'human'
    )
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'review_change_impact',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'change_impact_reviewed',
    jsonb_build_object(
      'all_impacts_reviewed', v_all_reviewed,
      'disposition', disposition,
      'impact_id', impact_id,
      'impact_run_id', impact_run_id,
      'reason_digest', 'sha256:' || encode(
        project_intelligence._sha256_text(v_reason), 'hex'
      )
    ),
    v_context.state_revision
  );
end
$function$;

create function projectceo_m4_api.define_milestone(
  project_id uuid,
  package_id uuid,
  production_package_version_id text,
  title text,
  area_node_ids jsonb,
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
  v_title text;
  v_area_node_ids text[];
  v_baseline_id text;
  v_graph_version_id text;
  v_milestone_id uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  v_title := projectceo_product._assert_text(title, 'title', 500);
  v_area_node_ids := projectceo_product._sorted_unique_text_array(
    area_node_ids,
    'areaNodeIds',
    false
  );
  select ppv.baseline_id, pb.graph_version_id
  into v_baseline_id, v_graph_version_id
  from projectceo_product.production_package_versions ppv
  join projectceo_product.project_baselines pb
    on pb.organization_id = ppv.organization_id
   and pb.project_id = ppv.project_id
   and pb.baseline_id = ppv.baseline_id
  where ppv.project_id = project_id
    and ppv.package_id = package_id
    and ppv.production_package_version_id = production_package_version_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"packageVersion"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_m4._human_command_context(
    project_id,
    package_id,
    'review_milestone',
    'define_milestone',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object(
      'areaNodeIds', to_jsonb(v_area_node_ids),
      'productionPackageVersionId', production_package_version_id,
      'title', v_title
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;

  perform projectceo_m4._assert_version_open(
    v_context.organization_id,
    project_id,
    package_id,
    production_package_version_id
  );

  if (
    select count(*)
    from project_intelligence.version_nodes version_node
    join project_intelligence.graph_nodes node
      on node.organization_id = version_node.organization_id
     and node.project_id = version_node.project_id
     and node.node_id = version_node.node_id
     and node.kind = 'area'
    where version_node.organization_id = v_context.organization_id
      and version_node.project_id = project_id
      and version_node.version_id = v_graph_version_id
      and version_node.node_id = any(v_area_node_ids)
  ) <> cardinality(v_area_node_ids) then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"MILESTONE_AREA_NOT_IN_EXACT_VERSION"}'::jsonb
    );
  end if;

  insert into projectceo_m4.milestones (
    organization_id,
    project_id,
    milestone_id,
    package_id,
    production_package_version_id,
    baseline_id,
    graph_version_id,
    title,
    defined_by_user_id
  ) values (
    v_context.organization_id,
    project_id,
    v_milestone_id,
    package_id,
    production_package_version_id,
    v_baseline_id,
    v_graph_version_id,
    v_title,
    v_context.actor_user_id
  );
  insert into projectceo_m4.milestone_areas (
    organization_id,
    project_id,
    milestone_id,
    package_id,
    production_package_version_id,
    baseline_id,
    graph_version_id,
    area_node_id,
    area_revision_id
  )
  select
    v_context.organization_id,
    project_id,
    v_milestone_id,
    package_id,
    production_package_version_id,
    v_baseline_id,
    v_graph_version_id,
    version_node.node_id,
    version_node.revision_id
  from project_intelligence.version_nodes version_node
  where version_node.organization_id = v_context.organization_id
    and version_node.project_id = project_id
    and version_node.version_id = v_graph_version_id
    and version_node.node_id = any(v_area_node_ids)
  order by version_node.node_id collate "C";

  v_result := jsonb_build_object(
    'areaCount', cardinality(v_area_node_ids),
    'areaNodeIds', to_jsonb(v_area_node_ids),
    'baselineId', v_baseline_id,
    'graphVersionId', v_graph_version_id,
    'id', v_milestone_id,
    'packageId', package_id,
    'productionPackageVersionId', production_package_version_id,
    'title', v_title
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'define_milestone',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'milestone_defined',
    jsonb_build_object(
      'area_count', cardinality(v_area_node_ids),
      'milestone_id', v_milestone_id,
      'production_package_version_id', production_package_version_id
    ),
    v_context.state_revision
  );
end
$function$;

create function projectceo_m4_api.register_photo_evidence(
  project_id uuid,
  milestone_id uuid,
  area_node_id text,
  source_id text,
  source_revision_id text,
  captured_at timestamptz,
  note text,
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
  v_milestone projectceo_m4.milestones%rowtype;
  v_area_revision_id text;
  v_source record;
  v_note text := nullif(btrim(coalesce(note, '')), '');
  v_photo_evidence_id uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  if v_note is not null and (v_note <> note or length(v_note) > 4000) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"note"}'::jsonb
    );
  end if;
  if captured_at is null
     or captured_at > statement_timestamp() + interval '5 minutes' then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"capturedAt"}'::jsonb
    );
  end if;
  select * into v_milestone
  from projectceo_m4.milestones milestone
  where milestone.project_id = project_id
    and milestone.milestone_id = milestone_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"milestone"}'::jsonb
    );
  end if;

  select * into v_context
  from projectceo_m4._human_command_context(
    project_id,
    v_milestone.package_id,
    'upload_photo_evidence',
    'register_photo_evidence',
    expected_state_revision,
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
  if v_context.replay is not null then return v_context.replay; end if;

  perform projectceo_m4._assert_version_open(
    v_context.organization_id,
    project_id,
    v_milestone.package_id,
    v_milestone.production_package_version_id
  );
  if exists (
    select 1
    from projectceo_m4.milestone_acceptances acceptance
    where acceptance.organization_id = v_context.organization_id
      and acceptance.project_id = project_id
      and acceptance.milestone_id = milestone_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"MILESTONE_ALREADY_ACCEPTED"}'::jsonb
    );
  end if;

  select area.area_revision_id into v_area_revision_id
  from projectceo_m4.milestone_areas area
  where area.organization_id = v_context.organization_id
    and area.project_id = project_id
    and area.milestone_id = milestone_id
    and area.area_node_id = area_node_id;
  if not found then
    perform projectceo_product._raise(
      'P1111',
      'validation_failed',
      '{"reason":"PHOTO_AREA_NOT_IN_MILESTONE"}'::jsonb
    );
  end if;

  select * into v_source
  from projectceo_m4._materialized_source(
    v_context.organization_id,
    project_id,
    v_milestone.package_id,
    source_id,
    source_revision_id,
    array['photo-evidence']::text[]
  );

  insert into projectceo_m4.photo_evidence (
    organization_id,
    project_id,
    photo_evidence_id,
    milestone_id,
    package_id,
    production_package_version_id,
    baseline_id,
    graph_version_id,
    area_node_id,
    area_revision_id,
    source_id,
    source_revision_id,
    source_checksum,
    storage_object_path,
    captured_at,
    protected_note,
    note_digest,
    registered_by_user_id
  ) values (
    v_context.organization_id,
    project_id,
    v_photo_evidence_id,
    milestone_id,
    v_milestone.package_id,
    v_milestone.production_package_version_id,
    v_milestone.baseline_id,
    v_milestone.graph_version_id,
    area_node_id,
    v_area_revision_id,
    source_id,
    source_revision_id,
    v_source.source_checksum,
    v_source.storage_object_path,
    captured_at,
    v_note,
    case when v_note is null then null
      else project_intelligence._sha256_text(v_note) end,
    v_context.actor_user_id
  );

  v_result := jsonb_build_object(
    'areaNodeId', area_node_id,
    'capturedAt', captured_at,
    'id', v_photo_evidence_id,
    'milestoneId', milestone_id,
    'packageId', v_milestone.package_id,
    'productionPackageVersionId',
      v_milestone.production_package_version_id,
    'sourceChecksum', 'sha256:' || encode(
      v_source.source_checksum,
      'hex'
    ),
    'sourceId', source_id,
    'sourceRevisionId', source_revision_id,
    'status', 'awaiting_review'
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'register_photo_evidence',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'photo_evidence_registered',
    jsonb_build_object(
      'area_node_id', area_node_id,
      'milestone_id', milestone_id,
      'photo_evidence_id', v_photo_evidence_id,
      'source_checksum', 'sha256:' || encode(
        v_source.source_checksum,
        'hex'
      ),
      'source_revision_id', source_revision_id
    ),
    v_context.state_revision
  );
end
$function$;

create function projectceo_m4_api.review_photo_evidence(
  project_id uuid,
  photo_evidence_id uuid,
  decision text,
  reason text,
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
  v_photo projectceo_m4.photo_evidence%rowtype;
  v_reason text;
  v_review_id uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  if decision not in ('accepted', 'rejected') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"decision"}'::jsonb
    );
  end if;
  v_reason := projectceo_product._assert_text(reason, 'reason', 4000);
  select * into v_photo
  from projectceo_m4.photo_evidence photo
  where photo.project_id = project_id
    and photo.photo_evidence_id = photo_evidence_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"photoEvidence"}'::jsonb
    );
  end if;
  select * into v_context
  from projectceo_m4._human_command_context(
    project_id,
    v_photo.package_id,
    'review_milestone',
    'review_photo_evidence',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object(
      'decision', decision,
      'photoEvidenceId', photo_evidence_id,
      'reason', v_reason
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;

  perform projectceo_m4._assert_version_open(
    v_context.organization_id,
    project_id,
    v_photo.package_id,
    v_photo.production_package_version_id
  );
  if exists (
    select 1
    from projectceo_m4.milestone_acceptances acceptance
    where acceptance.organization_id = v_context.organization_id
      and acceptance.project_id = project_id
      and acceptance.milestone_id = v_photo.milestone_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"MILESTONE_ALREADY_ACCEPTED"}'::jsonb
    );
  end if;
  if exists (
    select 1
    from projectceo_m4.photo_evidence_reviews review
    where review.organization_id = v_context.organization_id
      and review.project_id = project_id
      and review.photo_evidence_id = photo_evidence_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"PHOTO_ALREADY_REVIEWED"}'::jsonb
    );
  end if;

  insert into projectceo_m4.photo_evidence_reviews (
    organization_id,
    project_id,
    photo_review_id,
    photo_evidence_id,
    milestone_id,
    package_id,
    production_package_version_id,
    area_node_id,
    decision,
    protected_reason,
    reason_digest,
    reviewed_by_user_id
  ) values (
    v_context.organization_id,
    project_id,
    v_review_id,
    photo_evidence_id,
    v_photo.milestone_id,
    v_photo.package_id,
    v_photo.production_package_version_id,
    v_photo.area_node_id,
    decision,
    v_reason,
    project_intelligence._sha256_text(v_reason),
    v_context.actor_user_id
  );

  v_result := jsonb_build_object(
    'decision', decision,
    'id', v_review_id,
    'photoEvidenceId', photo_evidence_id,
    'reasonHash', 'sha256:' || encode(
      project_intelligence._sha256_text(v_reason), 'hex'
    ),
    'reviewedBy', jsonb_build_object(
      'actorId', v_context.actor_id,
      'actorType', 'human'
    )
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'review_photo_evidence',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'photo_evidence_reviewed',
    jsonb_build_object(
      'decision', decision,
      'photo_evidence_id', photo_evidence_id,
      'photo_review_id', v_review_id,
      'reason_digest', 'sha256:' || encode(
        project_intelligence._sha256_text(v_reason), 'hex'
      )
    ),
    v_context.state_revision
  );
end
$function$;

create function projectceo_m4_api.accept_milestone(
  project_id uuid,
  milestone_id uuid,
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
  v_milestone projectceo_m4.milestones%rowtype;
  v_acceptance_id uuid := extensions.gen_random_uuid();
  v_semantic_content jsonb;
  v_semantic_digest bytea;
  v_result jsonb;
begin
  select * into v_milestone
  from projectceo_m4.milestones milestone
  where milestone.project_id = project_id
    and milestone.milestone_id = milestone_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"milestone"}'::jsonb
    );
  end if;
  select * into v_context
  from projectceo_m4._human_command_context(
    project_id,
    v_milestone.package_id,
    'review_milestone',
    'accept_milestone',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object('milestoneId', milestone_id)
  );
  if v_context.replay is not null then return v_context.replay; end if;

  perform projectceo_m4._assert_version_open(
    v_context.organization_id,
    project_id,
    v_milestone.package_id,
    v_milestone.production_package_version_id
  );
  if exists (
    select 1
    from projectceo_m4.milestone_acceptances acceptance
    where acceptance.organization_id = v_context.organization_id
      and acceptance.project_id = project_id
      and acceptance.milestone_id = milestone_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"MILESTONE_ALREADY_ACCEPTED"}'::jsonb
    );
  end if;
  if not exists (
    select 1
    from projectceo_m4.milestone_areas area
    where area.organization_id = v_context.organization_id
      and area.project_id = project_id
      and area.milestone_id = milestone_id
  ) or exists (
    select 1
    from projectceo_m4.milestone_areas area
    where area.organization_id = v_context.organization_id
      and area.project_id = project_id
      and area.milestone_id = milestone_id
      and not exists (
        select 1
        from projectceo_m4.photo_evidence photo
        join projectceo_m4.photo_evidence_reviews review
          on review.organization_id = photo.organization_id
         and review.project_id = photo.project_id
         and review.photo_evidence_id = photo.photo_evidence_id
         and review.decision = 'accepted'
        where photo.organization_id = area.organization_id
          and photo.project_id = area.project_id
          and photo.milestone_id = area.milestone_id
          and photo.area_node_id = area.area_node_id
      )
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"MILESTONE_PHOTO_EVIDENCE_INCOMPLETE"}'::jsonb
    );
  end if;

  select jsonb_build_object(
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'acceptedPhotoEvidenceIds', (
          select jsonb_agg(photo.photo_evidence_id order by
            photo.photo_evidence_id::text collate "C")
          from projectceo_m4.photo_evidence photo
          join projectceo_m4.photo_evidence_reviews review
            on review.organization_id = photo.organization_id
           and review.project_id = photo.project_id
           and review.photo_evidence_id = photo.photo_evidence_id
           and review.decision = 'accepted'
          where photo.organization_id = area.organization_id
            and photo.project_id = area.project_id
            and photo.milestone_id = area.milestone_id
            and photo.area_node_id = area.area_node_id
        ),
        'areaNodeId', area.area_node_id,
        'areaRevisionId', area.area_revision_id
      ) order by area.area_node_id collate "C")
      from projectceo_m4.milestone_areas area
      where area.organization_id = v_context.organization_id
        and area.project_id = project_id
        and area.milestone_id = milestone_id
    ), '[]'::jsonb),
    'baselineId', v_milestone.baseline_id,
    'graphVersionId', v_milestone.graph_version_id,
    'milestoneId', milestone_id,
    'packageId', v_milestone.package_id,
    'productionPackageVersionId',
      v_milestone.production_package_version_id,
    'projectId', project_id,
    'schemaVersion', 'project-ceo-milestone-acceptance/0.1'
  ) into v_semantic_content;
  v_semantic_digest := project_intelligence._sha256_jsonb(
    v_semantic_content
  );

  insert into projectceo_m4.milestone_acceptances (
    organization_id,
    project_id,
    milestone_acceptance_id,
    milestone_id,
    package_id,
    production_package_version_id,
    baseline_id,
    graph_version_id,
    semantic_content,
    semantic_digest,
    accepted_by_user_id
  ) values (
    v_context.organization_id,
    project_id,
    v_acceptance_id,
    milestone_id,
    v_milestone.package_id,
    v_milestone.production_package_version_id,
    v_milestone.baseline_id,
    v_milestone.graph_version_id,
    v_semantic_content,
    v_semantic_digest,
    v_context.actor_user_id
  );
  set constraints
    projectceo_m4.m4_milestone_acceptance_closure immediate;
  set constraints
    projectceo_m4.m4_milestone_acceptance_closure deferred;

  v_result := jsonb_build_object(
    'id', v_acceptance_id,
    'milestoneId', milestone_id,
    'semanticContent', v_semantic_content,
    'semanticHash', 'sha256:' || encode(v_semantic_digest, 'hex'),
    'status', 'accepted'
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'accept_milestone',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'milestone_accepted',
    jsonb_build_object(
      'milestone_acceptance_id', v_acceptance_id,
      'milestone_id', milestone_id,
      'semantic_digest', 'sha256:' || encode(v_semantic_digest, 'hex')
    ),
    v_context.state_revision
  );
end
$function$;

create function projectceo_m4_api.register_handover_document(
  project_id uuid,
  package_id uuid,
  production_package_version_id text,
  document_kind text,
  source_id text,
  source_revision_id text,
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
  v_baseline_id text;
  v_source record;
  v_document_id uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  if document_kind not in ('acceptance_act', 'warranty', 'manual') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"documentKind"}'::jsonb
    );
  end if;
  select ppv.baseline_id into v_baseline_id
  from projectceo_product.production_package_versions ppv
  where ppv.project_id = project_id
    and ppv.package_id = package_id
    and ppv.production_package_version_id = production_package_version_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"packageVersion"}'::jsonb
    );
  end if;
  select * into v_context
  from projectceo_m4._human_command_context(
    project_id,
    package_id,
    'review_milestone',
    'register_handover_document',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object(
      'documentKind', document_kind,
      'productionPackageVersionId', production_package_version_id,
      'sourceId', source_id,
      'sourceRevisionId', source_revision_id
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;
  perform projectceo_m4._assert_version_open(
    v_context.organization_id,
    project_id,
    package_id,
    production_package_version_id
  );
  select * into v_source
  from projectceo_m4._materialized_source(
    v_context.organization_id,
    project_id,
    package_id,
    source_id,
    source_revision_id,
    array['document', 'reference']::text[]
  );

  insert into projectceo_m4.handover_documents (
    organization_id,
    project_id,
    handover_document_id,
    package_id,
    production_package_version_id,
    baseline_id,
    document_kind,
    source_id,
    source_revision_id,
    source_checksum,
    storage_object_path,
    registered_by_user_id
  ) values (
    v_context.organization_id,
    project_id,
    v_document_id,
    package_id,
    production_package_version_id,
    v_baseline_id,
    document_kind,
    source_id,
    source_revision_id,
    v_source.source_checksum,
    v_source.storage_object_path,
    v_context.actor_user_id
  );

  v_result := jsonb_build_object(
    'documentKind', document_kind,
    'id', v_document_id,
    'packageId', package_id,
    'productionPackageVersionId', production_package_version_id,
    'sourceChecksum', 'sha256:' || encode(
      v_source.source_checksum, 'hex'
    ),
    'sourceId', source_id,
    'sourceRevisionId', source_revision_id
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'register_handover_document',
    v_context.key_digest,
    v_context.request_digest,
    'human',
    v_context.actor_id,
    v_context.actor_user_id,
    v_result,
    'handover_document_registered',
    jsonb_build_object(
      'document_kind', document_kind,
      'handover_document_id', v_document_id,
      'source_checksum', 'sha256:' || encode(
        v_source.source_checksum, 'hex'
      ),
      'source_revision_id', source_revision_id
    ),
    v_context.state_revision
  );
end
$function$;

create function projectceo_m4_api.build_construction_handover(
  project_id uuid,
  package_id uuid,
  production_package_version_id text,
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
  v_baseline_id text;
  v_graph_version_id text;
  v_handover_id uuid := extensions.gen_random_uuid();
  v_semantic_content jsonb;
  v_semantic_digest bytea;
  v_result jsonb;
begin
  select ppv.baseline_id, pb.graph_version_id
  into v_baseline_id, v_graph_version_id
  from projectceo_product.production_package_versions ppv
  join projectceo_product.project_baselines pb
    on pb.organization_id = ppv.organization_id
   and pb.project_id = ppv.project_id
   and pb.baseline_id = ppv.baseline_id
  where ppv.project_id = project_id
    and ppv.package_id = package_id
    and ppv.production_package_version_id = production_package_version_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"packageVersion"}'::jsonb
    );
  end if;
  select * into v_context
  from projectceo_m4._worker_command_context(
    project_id,
    package_id,
    'build_construction_handover',
    expected_state_revision,
    idempotency_key,
    jsonb_build_object(
      'productionPackageVersionId', production_package_version_id
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;
  if exists (
    select 1
    from projectceo_m4.construction_handovers handover
    where handover.organization_id = v_context.organization_id
      and handover.project_id = project_id
      and handover.package_id = package_id
      and handover.production_package_version_id =
        production_package_version_id
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"HANDOVER_ALREADY_BUILT"}'::jsonb
    );
  end if;
  if not exists (
    select 1
    from projectceo_m4.milestones milestone
    where milestone.organization_id = v_context.organization_id
      and milestone.project_id = project_id
      and milestone.package_id = package_id
      and milestone.production_package_version_id =
        production_package_version_id
  ) or exists (
    select 1
    from projectceo_m4.milestones milestone
    where milestone.organization_id = v_context.organization_id
      and milestone.project_id = project_id
      and milestone.package_id = package_id
      and milestone.production_package_version_id =
        production_package_version_id
      and not exists (
        select 1
        from projectceo_m4.milestone_acceptances acceptance
        where acceptance.organization_id = milestone.organization_id
          and acceptance.project_id = milestone.project_id
          and acceptance.milestone_id = milestone.milestone_id
      )
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"MILESTONE_ACCEPTANCE_INCOMPLETE"}'::jsonb
    );
  end if;
  if not exists (
    select 1
    from projectceo_m4.handover_documents document
    where document.organization_id = v_context.organization_id
      and document.project_id = project_id
      and document.package_id = package_id
      and document.production_package_version_id =
        production_package_version_id
      and document.document_kind = 'warranty'
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"WARRANTY_DOCUMENT_REQUIRED"}'::jsonb
    );
  end if;

  select jsonb_build_object(
    'baselineId', v_baseline_id,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'documentId', document.handover_document_id,
        'documentKind', document.document_kind,
        'sourceChecksum', 'sha256:' || encode(
          document.source_checksum, 'hex'
        ),
        'sourceId', document.source_id,
        'sourceRevisionId', document.source_revision_id
      ) order by
        document.document_kind collate "C",
        document.handover_document_id::text collate "C")
      from projectceo_m4.handover_documents document
      where document.organization_id = v_context.organization_id
        and document.project_id = project_id
        and document.package_id = package_id
        and document.production_package_version_id =
          production_package_version_id
    ), '[]'::jsonb),
    'graphVersionId', v_graph_version_id,
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'acceptanceId', acceptance.milestone_acceptance_id,
        'acceptanceSemanticHash', 'sha256:' || encode(
          acceptance.semantic_digest, 'hex'
        ),
        'areas', (
          select jsonb_agg(jsonb_build_object(
            'acceptedPhotos', (
              select jsonb_agg(jsonb_build_object(
                'photoEvidenceId', photo.photo_evidence_id,
                'sourceChecksum', 'sha256:' || encode(
                  photo.source_checksum, 'hex'
                ),
                'sourceId', photo.source_id,
                'sourceRevisionId', photo.source_revision_id
              ) order by photo.photo_evidence_id::text collate "C")
              from projectceo_m4.photo_evidence photo
              join projectceo_m4.photo_evidence_reviews review
                on review.organization_id = photo.organization_id
               and review.project_id = photo.project_id
               and review.photo_evidence_id = photo.photo_evidence_id
               and review.decision = 'accepted'
              where photo.organization_id = area.organization_id
                and photo.project_id = area.project_id
                and photo.milestone_id = area.milestone_id
                and photo.area_node_id = area.area_node_id
            ),
            'areaNodeId', area.area_node_id,
            'areaRevisionId', area.area_revision_id
          ) order by area.area_node_id collate "C")
          from projectceo_m4.milestone_areas area
          where area.organization_id = milestone.organization_id
            and area.project_id = milestone.project_id
            and area.milestone_id = milestone.milestone_id
        ),
        'milestoneId', milestone.milestone_id,
        'title', milestone.title
      ) order by milestone.milestone_id::text collate "C")
      from projectceo_m4.milestones milestone
      join projectceo_m4.milestone_acceptances acceptance
        on acceptance.organization_id = milestone.organization_id
       and acceptance.project_id = milestone.project_id
       and acceptance.milestone_id = milestone.milestone_id
      where milestone.organization_id = v_context.organization_id
        and milestone.project_id = project_id
        and milestone.package_id = package_id
        and milestone.production_package_version_id =
          production_package_version_id
    ), '[]'::jsonb),
    'packageId', package_id,
    'productionPackageVersionId', production_package_version_id,
    'projectId', project_id,
    'schemaVersion', 'project-ceo-construction-handover/0.1'
  ) into v_semantic_content;
  v_semantic_digest := project_intelligence._sha256_jsonb(
    v_semantic_content
  );

  insert into projectceo_m4.construction_handovers (
    organization_id,
    project_id,
    construction_handover_id,
    package_id,
    production_package_version_id,
    baseline_id,
    graph_version_id,
    semantic_content,
    semantic_digest,
    contract_version,
    hash_contract_version,
    created_by_id
  ) values (
    v_context.organization_id,
    project_id,
    v_handover_id,
    package_id,
    production_package_version_id,
    v_baseline_id,
    v_graph_version_id,
    v_semantic_content,
    v_semantic_digest,
    'project-ceo-construction-handover/0.1',
    'jsonb-recursive-sorted-object-keys-arrays-contract-order/1',
    v_context.actor_id
  );

  insert into projectceo_m4.handover_milestone_refs (
    organization_id,
    project_id,
    construction_handover_id,
    package_id,
    production_package_version_id,
    handover_semantic_digest,
    milestone_acceptance_id,
    milestone_id,
    milestone_semantic_digest
  )
  select
    v_context.organization_id,
    project_id,
    v_handover_id,
    package_id,
    production_package_version_id,
    v_semantic_digest,
    acceptance.milestone_acceptance_id,
    acceptance.milestone_id,
    acceptance.semantic_digest
  from projectceo_m4.milestone_acceptances acceptance
  where acceptance.organization_id = v_context.organization_id
    and acceptance.project_id = project_id
    and acceptance.package_id = package_id
    and acceptance.production_package_version_id =
      production_package_version_id
  order by acceptance.milestone_id::text collate "C";

  insert into projectceo_m4.handover_photo_refs (
    organization_id,
    project_id,
    construction_handover_id,
    package_id,
    production_package_version_id,
    handover_semantic_digest,
    photo_review_id,
    photo_evidence_id,
    decision
  )
  select
    v_context.organization_id,
    project_id,
    v_handover_id,
    package_id,
    production_package_version_id,
    v_semantic_digest,
    review.photo_review_id,
    review.photo_evidence_id,
    review.decision
  from projectceo_m4.photo_evidence_reviews review
  join projectceo_m4.photo_evidence photo
    on photo.organization_id = review.organization_id
   and photo.project_id = review.project_id
   and photo.photo_evidence_id = review.photo_evidence_id
  where review.organization_id = v_context.organization_id
    and review.project_id = project_id
    and review.decision = 'accepted'
    and photo.package_id = package_id
    and photo.production_package_version_id =
      production_package_version_id
  order by review.photo_evidence_id::text collate "C";

  insert into projectceo_m4.handover_document_refs (
    organization_id,
    project_id,
    construction_handover_id,
    package_id,
    production_package_version_id,
    handover_semantic_digest,
    handover_document_id,
    document_kind,
    source_revision_id,
    source_checksum
  )
  select
    v_context.organization_id,
    project_id,
    v_handover_id,
    package_id,
    production_package_version_id,
    v_semantic_digest,
    document.handover_document_id,
    document.document_kind,
    document.source_revision_id,
    document.source_checksum
  from projectceo_m4.handover_documents document
  where document.organization_id = v_context.organization_id
    and document.project_id = project_id
    and document.package_id = package_id
    and document.production_package_version_id =
      production_package_version_id
  order by document.handover_document_id::text collate "C";

  set constraints
    projectceo_m4.m4_construction_handover_closure immediate;
  set constraints
    projectceo_m4.m4_construction_handover_closure deferred;

  v_result := jsonb_build_object(
    'contractVersion', 'project-ceo-construction-handover/0.1',
    'hashContract', jsonb_build_object(
      'algorithm', 'sha256',
      'canonicalization',
        'jsonb_recursive_sorted_object_keys_arrays_contract_order',
      'encoding', 'utf-8',
      'excludedVolatileFields', jsonb_build_array(
        'artifactId', 'generatedAt', 'jobStatus', 'signedUrl'
      ),
      'hashedField', 'semanticContent'
    ),
    'id', v_handover_id,
    'semanticContent', v_semantic_content,
    'semanticHash', 'sha256:' || encode(v_semantic_digest, 'hex')
  );
  return projectceo_product._complete_command(
    v_context.organization_id,
    project_id,
    'build_construction_handover',
    v_context.key_digest,
    v_context.request_digest,
    'system',
    v_context.actor_id,
    null,
    v_result,
    'construction_handover_built',
    jsonb_build_object(
      'construction_handover_id', v_handover_id,
      'production_package_version_id', production_package_version_id,
      'semantic_digest', 'sha256:' || encode(v_semantic_digest, 'hex')
    ),
    v_context.state_revision
  );
end
$function$;

create function projectceo_m4_api.get_execution_delivery(
  project_id uuid,
  package_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_state_revision bigint;
  v_data jsonb;
begin
  select distinct
    context.organization_id,
    context.actor_user_id,
    context.actor_id
  into v_context
  from projectceo_foundation._authorize_package_human(
    project_id,
    package_id,
    'view_project'
  ) context;
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id
    and pw.project_id = project_id;

  select jsonb_build_object(
    'changeRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'deltaCostRub', request.delta_cost_rub,
        'deltaDays', request.delta_days,
        'fromBaselineId', request.from_baseline_id,
        'id', request.change_request_id,
        'initiatorRole', request.initiator_role,
        'proposedBaselineId', request.proposed_baseline_id,
        'reason', request.protected_reason,
        'reasonHash', 'sha256:' || encode(request.reason_digest, 'hex'),
        'requestedAt', request.requested_at,
        'rootCount', (
          select count(*)
          from projectceo_m4.change_request_roots root
          where root.organization_id = request.organization_id
            and root.project_id = request.project_id
            and root.change_request_id = request.change_request_id
        )
      ) order by request.requested_at desc)
      from projectceo_m4.change_requests request
      where request.organization_id = v_context.organization_id
        and request.project_id = project_id
        and request.package_id = package_id
    ), '[]'::jsonb),
    'impactRuns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'changeRequestId', run.change_request_id,
        'id', run.impact_run_id,
        'impacts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'changedNodeId', impact.changed_node_id,
            'disposition', review.disposition,
            'distance', impact.distance,
            'id', impact.impact_id,
            'impactedNodeId', impact.impacted_node_id,
            'nodePath', to_jsonb(impact.node_path),
            'reviewReason', review.protected_reason
          ) order by impact.changed_node_id collate "C",
                     impact.distance,
                     impact.impacted_node_id collate "C")
          from projectceo_m4.impacts impact
          left join projectceo_m4.impact_reviews review
            on review.organization_id = impact.organization_id
           and review.project_id = impact.project_id
           and review.impact_run_id = impact.impact_run_id
           and review.impact_id = impact.impact_id
          where impact.organization_id = run.organization_id
            and impact.project_id = run.project_id
            and impact.impact_run_id = run.impact_run_id
        ), '[]'::jsonb),
        'maxDepth', run.max_depth,
        'resultHash', 'sha256:' || encode(run.result_digest, 'hex'),
        'targetBaselineId', run.target_baseline_id,
        'targetGraphVersionId', run.target_graph_version_id
      ) order by run.created_at desc)
      from projectceo_m4.impact_runs run
      where run.organization_id = v_context.organization_id
        and run.project_id = project_id
        and run.package_id = package_id
    ), '[]'::jsonb),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'acceptance', case when acceptance.milestone_acceptance_id is null
          then null else jsonb_build_object(
            'id', acceptance.milestone_acceptance_id,
            'semanticHash', 'sha256:' || encode(
              acceptance.semantic_digest, 'hex'
            )
          ) end,
        'areas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'areaNodeId', area.area_node_id,
            'areaRevisionId', area.area_revision_id,
            'photos', coalesce((
              select jsonb_agg(jsonb_build_object(
                'capturedAt', photo.captured_at,
                'decision', review.decision,
                'id', photo.photo_evidence_id,
                'note', photo.protected_note,
                'sourceChecksum', 'sha256:' || encode(
                  photo.source_checksum, 'hex'
                ),
                'sourceId', photo.source_id,
                'sourceRevisionId', photo.source_revision_id
              ) order by photo.registered_at)
              from projectceo_m4.photo_evidence photo
              left join projectceo_m4.photo_evidence_reviews review
                on review.organization_id = photo.organization_id
               and review.project_id = photo.project_id
               and review.photo_evidence_id = photo.photo_evidence_id
              where photo.organization_id = area.organization_id
                and photo.project_id = area.project_id
                and photo.milestone_id = area.milestone_id
                and photo.area_node_id = area.area_node_id
            ), '[]'::jsonb)
          ) order by area.area_node_id collate "C")
          from projectceo_m4.milestone_areas area
          where area.organization_id = milestone.organization_id
            and area.project_id = milestone.project_id
            and area.milestone_id = milestone.milestone_id
        ), '[]'::jsonb),
        'id', milestone.milestone_id,
        'productionPackageVersionId',
          milestone.production_package_version_id,
        'title', milestone.title
      ) order by milestone.defined_at desc)
      from projectceo_m4.milestones milestone
      left join projectceo_m4.milestone_acceptances acceptance
        on acceptance.organization_id = milestone.organization_id
       and acceptance.project_id = milestone.project_id
       and acceptance.milestone_id = milestone.milestone_id
      where milestone.organization_id = v_context.organization_id
        and milestone.project_id = project_id
        and milestone.package_id = package_id
    ), '[]'::jsonb),
    'handoverDocuments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'documentKind', document.document_kind,
        'id', document.handover_document_id,
        'productionPackageVersionId',
          document.production_package_version_id,
        'sourceChecksum', 'sha256:' || encode(
          document.source_checksum, 'hex'
        ),
        'sourceId', document.source_id,
        'sourceRevisionId', document.source_revision_id
      ) order by document.registered_at desc)
      from projectceo_m4.handover_documents document
      where document.organization_id = v_context.organization_id
        and document.project_id = project_id
        and document.package_id = package_id
    ), '[]'::jsonb),
    'constructionHandovers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contractVersion', handover.contract_version,
        'createdAt', handover.created_at,
        'id', handover.construction_handover_id,
        'productionPackageVersionId',
          handover.production_package_version_id,
        'semanticContent', handover.semantic_content,
        'semanticHash', 'sha256:' || encode(
          handover.semantic_digest, 'hex'
        )
      ) order by handover.created_at desc)
      from projectceo_m4.construction_handovers handover
      where handover.organization_id = v_context.organization_id
        and handover.project_id = project_id
        and handover.package_id = package_id
    ), '[]'::jsonb)
  ) into v_data;

  return jsonb_build_object(
    'contractVersion', 'project-ceo-m4-delivery/0.1',
    'data', v_data,
    'error', null,
    'requestId', 'db:' || extensions.gen_random_uuid()::text,
    'scope', jsonb_build_object(
      'organizationId', v_context.organization_id,
      'packageId', package_id,
      'projectId', project_id
    ),
    'stateRevision', v_state_revision
  );
end
$function$;

do $function_ownership$
declare
  v_function text;
begin
  for v_function in
    select format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)
    )
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('projectceo_m4', 'projectceo_m4_api')
  loop
    execute 'alter function ' || v_function || ' owner to pi_table_owner';
  end loop;
end
$function_ownership$;

revoke all on all functions in schema projectceo_m4
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on all functions in schema projectceo_m4_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant usage on schema projectceo_m4_api to authenticated, service_role;

grant execute on function
  projectceo_m4_api.submit_change_request(
    uuid, uuid, text, text, text, text, bigint, integer, bigint, text
  ),
  projectceo_m4_api.review_change_impact(
    uuid, uuid, text, text, text, bigint, text
  ),
  projectceo_m4_api.define_milestone(
    uuid, uuid, text, text, jsonb, bigint, text
  ),
  projectceo_m4_api.register_photo_evidence(
    uuid, uuid, text, text, text, timestamptz, text, bigint, text
  ),
  projectceo_m4_api.review_photo_evidence(
    uuid, uuid, text, text, bigint, text
  ),
  projectceo_m4_api.accept_milestone(
    uuid, uuid, bigint, text
  ),
  projectceo_m4_api.register_handover_document(
    uuid, uuid, text, text, text, text, bigint, text
  ),
  projectceo_m4_api.get_execution_delivery(uuid, uuid)
  to authenticated;

grant execute on function
  projectceo_m4_api.calculate_change_impact(
    uuid, uuid, integer, bigint, text
  ),
  projectceo_m4_api.build_construction_handover(
    uuid, uuid, text, bigint, text
  )
  to service_role;

commit;
