-- ProjectCEO RU thin M4: change, field evidence, acceptance and handover.
--
-- Additive local candidate only. Private persistence is append-only and is
-- reachable by application code exclusively through fixed-definer RPCs.

begin;

set local check_function_bodies = on;

create schema projectceo_m4 authorization pi_table_owner;
create schema projectceo_m4_api authorization pi_table_owner;

revoke all on schema projectceo_m4
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on schema projectceo_m4_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

alter default privileges for role pi_table_owner
  in schema projectceo_m4
  revoke all on tables from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema projectceo_m4
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema projectceo_m4_api
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Exact cross-module keys used by M4 composite foreign keys.
alter table projectceo_product.project_baselines
  add constraint project_baselines_exact_lineage_key
  unique (
    organization_id,
    project_id,
    baseline_id,
    previous_baseline_id
  );

alter table projectceo_product.project_baselines
  add constraint project_baselines_exact_graph_key
  unique (
    organization_id,
    project_id,
    baseline_id,
    graph_version_id
  );

alter table projectceo_product.project_baseline_refs
  add constraint project_baseline_refs_exact_entity_key
  unique (
    organization_id,
    project_id,
    baseline_id,
    target_kind,
    entity_id,
    revision_id
  );

alter table project_intelligence.sources
  add constraint sources_exact_object_key
  unique (
    organization_id,
    project_id,
    source_id,
    checksum,
    storage_object_path
  );

alter table project_intelligence.graph_edges
  add constraint graph_edges_exact_semantic_key
  unique (
    organization_id,
    project_id,
    edge_id,
    from_node_id,
    to_node_id,
    relation
  );

alter table projectceo_foundation.source_inventory_records
  add constraint source_inventory_exact_materialized_key
  unique (
    organization_id,
    project_id,
    package_id,
    logical_source_id,
    source_revision_id,
    checksum
  );

-- Reuse the Product Brain idempotency and append-only audit ledger while
-- keeping the M4 data model in its own private schema.
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

alter table projectceo_product.audit_events
  drop constraint audit_events_event_type_check;
alter table projectceo_product.audit_events
  add constraint audit_events_event_type_check
  check (event_type in (
    'decision_revision_appended',
    'selection_revision_appended',
    'price_observation_appended',
    'approval_package_created',
    'approval_package_submitted',
    'approval_package_reviewed',
    'project_baseline_published',
    'production_package_version_published',
    'release_artifact_built',
    'release_distributed',
    'release_acknowledged',
    'no_change_approved',
    'change_request_submitted',
    'change_impact_calculated',
    'change_impact_reviewed',
    'milestone_defined',
    'photo_evidence_registered',
    'photo_evidence_reviewed',
    'milestone_accepted',
    'handover_document_registered',
    'construction_handover_built'
  ));

create table projectceo_m4.change_requests (
  organization_id uuid not null,
  project_id uuid not null,
  change_request_id uuid not null default extensions.gen_random_uuid(),
  package_id uuid not null,
  from_baseline_id text not null,
  proposed_baseline_id text not null,
  from_production_package_version_id text not null,
  protected_reason text not null
    check (
      char_length(btrim(protected_reason)) between 1 and 4000
      and protected_reason = btrim(protected_reason)
    ),
  reason_digest bytea not null check (octet_length(reason_digest) = 32),
  initiator_role text not null check (initiator_role in (
    'owner', 'client', 'architect', 'builder'
  )),
  delta_cost_rub bigint not null
    check (
      delta_cost_rub between -9007199254740991 and 9007199254740991
    ),
  delta_days integer not null,
  requested_by_user_id uuid not null,
  requested_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, change_request_id),
  constraint m4_change_request_project_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (
      organization_id,
      project_id
    )
    on delete restrict,
  constraint m4_change_request_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint m4_change_request_from_package_fkey
    foreign key (
      organization_id,
      project_id,
      from_baseline_id,
      package_id
    )
    references projectceo_product.project_baseline_packages (
      organization_id,
      project_id,
      baseline_id,
      package_id
    )
    on delete restrict,
  constraint m4_change_request_to_package_fkey
    foreign key (
      organization_id,
      project_id,
      proposed_baseline_id,
      package_id
    )
    references projectceo_product.project_baseline_packages (
      organization_id,
      project_id,
      baseline_id,
      package_id
    )
    on delete restrict,
  constraint m4_change_request_lineage_fkey
    foreign key (
      organization_id,
      project_id,
      proposed_baseline_id,
      from_baseline_id
    )
    references projectceo_product.project_baselines (
      organization_id,
      project_id,
      baseline_id,
      previous_baseline_id
    )
    on delete restrict,
  constraint m4_change_request_from_version_fkey
    foreign key (
      organization_id,
      project_id,
      package_id,
      from_baseline_id,
      from_production_package_version_id
    )
    references projectceo_product.production_package_versions (
      organization_id,
      project_id,
      package_id,
      baseline_id,
      production_package_version_id
    )
    on delete restrict,
  constraint m4_change_request_actor_fkey
    foreign key (organization_id, requested_by_user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint m4_change_request_baselines_differ_check
    check (from_baseline_id <> proposed_baseline_id),
  constraint m4_change_request_exact_key
    unique (
      organization_id,
      project_id,
      change_request_id,
      package_id,
      from_baseline_id,
      proposed_baseline_id
    ),
  constraint m4_change_request_target_key
    unique (
      organization_id,
      project_id,
      change_request_id,
      package_id,
      proposed_baseline_id
    ),
  constraint m4_change_request_transition_key
    unique (
      organization_id,
      project_id,
      package_id,
      from_baseline_id,
      proposed_baseline_id
    )
);

create index m4_change_requests_package_idx
  on projectceo_m4.change_requests (
    organization_id,
    project_id,
    package_id,
    requested_at desc
  );
create index m4_change_requests_from_package_idx
  on projectceo_m4.change_requests (
    organization_id,
    project_id,
    from_baseline_id,
    package_id
  );
create index m4_change_requests_to_package_idx
  on projectceo_m4.change_requests (
    organization_id,
    project_id,
    proposed_baseline_id,
    package_id
  );
create index m4_change_requests_lineage_idx
  on projectceo_m4.change_requests (
    organization_id,
    project_id,
    proposed_baseline_id,
    from_baseline_id
  );
create index m4_change_requests_from_version_idx
  on projectceo_m4.change_requests (
    organization_id,
    project_id,
    package_id,
    from_baseline_id,
    from_production_package_version_id
  );
create index m4_change_requests_actor_idx
  on projectceo_m4.change_requests (
    organization_id,
    requested_by_user_id
  );

create table projectceo_m4.change_request_roots (
  organization_id uuid not null,
  project_id uuid not null,
  change_request_id uuid not null,
  package_id uuid not null,
  from_baseline_id text not null,
  proposed_baseline_id text not null,
  target_kind text not null check (target_kind in (
    'decision_revision', 'selection_revision'
  )),
  node_id text not null,
  from_revision_id text not null,
  to_revision_id text not null,
  primary key (
    organization_id,
    project_id,
    change_request_id,
    node_id
  ),
  constraint m4_change_roots_request_fkey
    foreign key (
      organization_id,
      project_id,
      change_request_id,
      package_id,
      from_baseline_id,
      proposed_baseline_id
    )
    references projectceo_m4.change_requests (
      organization_id,
      project_id,
      change_request_id,
      package_id,
      from_baseline_id,
      proposed_baseline_id
    )
    on delete restrict,
  constraint m4_change_roots_from_ref_fkey
    foreign key (
      organization_id,
      project_id,
      from_baseline_id,
      target_kind,
      node_id,
      from_revision_id
    )
    references projectceo_product.project_baseline_refs (
      organization_id,
      project_id,
      baseline_id,
      target_kind,
      entity_id,
      revision_id
    )
    on delete restrict,
  constraint m4_change_roots_to_ref_fkey
    foreign key (
      organization_id,
      project_id,
      proposed_baseline_id,
      target_kind,
      node_id,
      to_revision_id
    )
    references projectceo_product.project_baseline_refs (
      organization_id,
      project_id,
      baseline_id,
      target_kind,
      entity_id,
      revision_id
    )
    on delete restrict,
  constraint m4_change_roots_revision_check
    check (from_revision_id <> to_revision_id),
  constraint m4_change_roots_exact_key
    unique (
      organization_id,
      project_id,
      change_request_id,
      package_id,
      node_id,
      to_revision_id
    )
);

create index m4_change_roots_request_idx
  on projectceo_m4.change_request_roots (
    organization_id,
    project_id,
    change_request_id,
    package_id,
    from_baseline_id,
    proposed_baseline_id
  );
create index m4_change_roots_from_ref_idx
  on projectceo_m4.change_request_roots (
    organization_id,
    project_id,
    from_baseline_id,
    target_kind,
    node_id,
    from_revision_id
  );
create index m4_change_roots_to_ref_idx
  on projectceo_m4.change_request_roots (
    organization_id,
    project_id,
    proposed_baseline_id,
    target_kind,
    node_id,
    to_revision_id
  );

create table projectceo_m4.impact_runs (
  organization_id uuid not null,
  project_id uuid not null,
  impact_run_id uuid not null default extensions.gen_random_uuid(),
  change_request_id uuid not null,
  package_id uuid not null,
  target_baseline_id text not null,
  target_graph_version_id text not null,
  max_depth integer not null check (max_depth between 1 and 20),
  algorithm jsonb not null check (jsonb_typeof(algorithm) = 'object'),
  result_digest bytea not null check (octet_length(result_digest) = 32),
  created_by_id text not null check (created_by_id like 'system:%'),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, impact_run_id),
  constraint m4_impact_runs_request_fkey
    foreign key (
      organization_id,
      project_id,
      change_request_id,
      package_id,
      target_baseline_id
    )
    references projectceo_m4.change_requests (
      organization_id,
      project_id,
      change_request_id,
      package_id,
      proposed_baseline_id
    )
    on delete restrict,
  constraint m4_impact_runs_target_graph_fkey
    foreign key (
      organization_id,
      project_id,
      target_baseline_id,
      target_graph_version_id
    )
    references projectceo_product.project_baselines (
      organization_id,
      project_id,
      baseline_id,
      graph_version_id
    )
    on delete restrict,
  constraint m4_impact_runs_request_key
    unique (organization_id, project_id, change_request_id),
  constraint m4_impact_runs_exact_key
    unique (
      organization_id,
      project_id,
      impact_run_id,
      change_request_id,
      package_id,
      target_graph_version_id
    )
);

create index m4_impact_runs_request_idx
  on projectceo_m4.impact_runs (
    organization_id,
    project_id,
    change_request_id,
    package_id,
    target_baseline_id
  );
create index m4_impact_runs_target_graph_idx
  on projectceo_m4.impact_runs (
    organization_id,
    project_id,
    target_baseline_id,
    target_graph_version_id
  );

create table projectceo_m4.impacts (
  organization_id uuid not null,
  project_id uuid not null,
  impact_id text not null
    check (
      char_length(btrim(impact_id)) between 1 and 160
      and impact_id = btrim(impact_id)
    ),
  impact_run_id uuid not null,
  change_request_id uuid not null,
  package_id uuid not null,
  target_graph_version_id text not null,
  changed_node_id text not null,
  changed_revision_id text not null,
  impacted_node_id text not null,
  impacted_revision_id text not null,
  distance integer not null check (distance between 1 and 20),
  node_path text[] not null,
  initial_status text not null default 'needs_review'
    check (initial_status = 'needs_review'),
  primary key (organization_id, project_id, impact_id),
  constraint m4_impacts_run_fkey
    foreign key (
      organization_id,
      project_id,
      impact_run_id,
      change_request_id,
      package_id,
      target_graph_version_id
    )
    references projectceo_m4.impact_runs (
      organization_id,
      project_id,
      impact_run_id,
      change_request_id,
      package_id,
      target_graph_version_id
    )
    on delete restrict,
  constraint m4_impacts_root_fkey
    foreign key (
      organization_id,
      project_id,
      change_request_id,
      package_id,
      changed_node_id,
      changed_revision_id
    )
    references projectceo_m4.change_request_roots (
      organization_id,
      project_id,
      change_request_id,
      package_id,
      node_id,
      to_revision_id
    )
    on delete restrict,
  constraint m4_impacts_target_revision_fkey
    foreign key (
      organization_id,
      project_id,
      target_graph_version_id,
      impacted_node_id,
      impacted_revision_id
    )
    references project_intelligence.version_nodes (
      organization_id,
      project_id,
      version_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint m4_impacts_path_shape_check
    check (
      cardinality(node_path) = distance + 1
      and node_path[1] = changed_node_id
      and node_path[cardinality(node_path)] = impacted_node_id
      and changed_node_id <> impacted_node_id
    ),
  constraint m4_impacts_run_target_key
    unique (
      organization_id,
      project_id,
      impact_run_id,
      impact_id,
      package_id,
      target_graph_version_id
    )
);

create index m4_impacts_run_idx
  on projectceo_m4.impacts (
    organization_id,
    project_id,
    impact_run_id,
    change_request_id,
    package_id,
    target_graph_version_id
  );
create index m4_impacts_root_idx
  on projectceo_m4.impacts (
    organization_id,
    project_id,
    change_request_id,
    package_id,
    changed_node_id,
    changed_revision_id
  );
create index m4_impacts_target_revision_idx
  on projectceo_m4.impacts (
    organization_id,
    project_id,
    target_graph_version_id,
    impacted_node_id,
    impacted_revision_id
  );

create table projectceo_m4.impact_path_steps (
  organization_id uuid not null,
  project_id uuid not null,
  impact_id text not null,
  impact_run_id uuid not null,
  package_id uuid not null,
  target_graph_version_id text not null,
  step_no integer not null check (step_no between 0 and 19),
  edge_id text not null,
  relation text not null check (relation in (
    'depends_on', 'derived_from', 'specified_by', 'satisfies'
  )),
  from_node_id text not null,
  to_node_id text not null,
  primary key (organization_id, project_id, impact_id, step_no),
  constraint m4_impact_steps_impact_fkey
    foreign key (
      organization_id,
      project_id,
      impact_run_id,
      impact_id,
      package_id,
      target_graph_version_id
    )
    references projectceo_m4.impacts (
      organization_id,
      project_id,
      impact_run_id,
      impact_id,
      package_id,
      target_graph_version_id
    )
    on delete restrict,
  constraint m4_impact_steps_version_edge_fkey
    foreign key (
      organization_id,
      project_id,
      target_graph_version_id,
      edge_id
    )
    references project_intelligence.version_edges (
      organization_id,
      project_id,
      version_id,
      edge_id
    )
    on delete restrict,
  constraint m4_impact_steps_graph_edge_fkey
    foreign key (
      organization_id,
      project_id,
      edge_id,
      from_node_id,
      to_node_id,
      relation
    )
    references project_intelligence.graph_edges (
      organization_id,
      project_id,
      edge_id,
      from_node_id,
      to_node_id,
      relation
    )
    on delete restrict
);

create index m4_impact_steps_impact_idx
  on projectceo_m4.impact_path_steps (
    organization_id,
    project_id,
    impact_run_id,
    impact_id,
    package_id,
    target_graph_version_id
  );
create index m4_impact_steps_version_edge_idx
  on projectceo_m4.impact_path_steps (
    organization_id,
    project_id,
    target_graph_version_id,
    edge_id
  );
create index m4_impact_steps_graph_edge_idx
  on projectceo_m4.impact_path_steps (
    organization_id,
    project_id,
    edge_id,
    from_node_id,
    to_node_id,
    relation
  );

create table projectceo_m4.impact_reviews (
  organization_id uuid not null,
  project_id uuid not null,
  impact_review_id uuid not null default extensions.gen_random_uuid(),
  impact_run_id uuid not null,
  impact_id text not null,
  package_id uuid not null,
  target_graph_version_id text not null,
  disposition text not null check (disposition in (
    'accepted', 'resolved', 'dismissed'
  )),
  protected_reason text not null
    check (
      char_length(btrim(protected_reason)) between 1 and 4000
      and protected_reason = btrim(protected_reason)
    ),
  reason_digest bytea not null check (octet_length(reason_digest) = 32),
  reviewed_by_user_id uuid not null,
  reviewed_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, impact_review_id),
  constraint m4_impact_reviews_impact_fkey
    foreign key (
      organization_id,
      project_id,
      impact_run_id,
      impact_id,
      package_id,
      target_graph_version_id
    )
    references projectceo_m4.impacts (
      organization_id,
      project_id,
      impact_run_id,
      impact_id,
      package_id,
      target_graph_version_id
    )
    on delete restrict,
  constraint m4_impact_reviews_actor_fkey
    foreign key (organization_id, reviewed_by_user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint m4_impact_reviews_impact_key
    unique (organization_id, project_id, impact_run_id, impact_id)
);

create index m4_impact_reviews_impact_idx
  on projectceo_m4.impact_reviews (
    organization_id,
    project_id,
    impact_run_id,
    impact_id,
    package_id,
    target_graph_version_id
  );
create index m4_impact_reviews_actor_idx
  on projectceo_m4.impact_reviews (
    organization_id,
    reviewed_by_user_id
  );

create table projectceo_m4.milestones (
  organization_id uuid not null,
  project_id uuid not null,
  milestone_id uuid not null default extensions.gen_random_uuid(),
  package_id uuid not null,
  production_package_version_id text not null,
  baseline_id text not null,
  graph_version_id text not null,
  title text not null
    check (
      char_length(btrim(title)) between 1 and 500
      and title = btrim(title)
    ),
  defined_by_user_id uuid not null,
  defined_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, milestone_id),
  constraint m4_milestones_package_version_fkey
    foreign key (
      organization_id,
      project_id,
      package_id,
      baseline_id,
      production_package_version_id
    )
    references projectceo_product.production_package_versions (
      organization_id,
      project_id,
      package_id,
      baseline_id,
      production_package_version_id
    )
    on delete restrict,
  constraint m4_milestones_graph_fkey
    foreign key (
      organization_id,
      project_id,
      baseline_id,
      graph_version_id
    )
    references projectceo_product.project_baselines (
      organization_id,
      project_id,
      baseline_id,
      graph_version_id
    )
    on delete restrict,
  constraint m4_milestones_actor_fkey
    foreign key (organization_id, defined_by_user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint m4_milestones_title_key
    unique (
      organization_id,
      project_id,
      package_id,
      production_package_version_id,
      title
    ),
  constraint m4_milestones_exact_key
    unique (
      organization_id,
      project_id,
      milestone_id,
      package_id,
      production_package_version_id,
      baseline_id,
      graph_version_id
    )
);

create index m4_milestones_package_version_idx
  on projectceo_m4.milestones (
    organization_id,
    project_id,
    package_id,
    baseline_id,
    production_package_version_id
  );
create index m4_milestones_graph_idx
  on projectceo_m4.milestones (
    organization_id,
    project_id,
    baseline_id,
    graph_version_id
  );
create index m4_milestones_actor_idx
  on projectceo_m4.milestones (
    organization_id,
    defined_by_user_id
  );

create table projectceo_m4.milestone_areas (
  organization_id uuid not null,
  project_id uuid not null,
  milestone_id uuid not null,
  package_id uuid not null,
  production_package_version_id text not null,
  baseline_id text not null,
  graph_version_id text not null,
  area_node_id text not null,
  area_revision_id text not null,
  primary key (
    organization_id,
    project_id,
    milestone_id,
    area_node_id
  ),
  constraint m4_milestone_areas_milestone_fkey
    foreign key (
      organization_id,
      project_id,
      milestone_id,
      package_id,
      production_package_version_id,
      baseline_id,
      graph_version_id
    )
    references projectceo_m4.milestones (
      organization_id,
      project_id,
      milestone_id,
      package_id,
      production_package_version_id,
      baseline_id,
      graph_version_id
    )
    on delete restrict,
  constraint m4_milestone_areas_revision_fkey
    foreign key (
      organization_id,
      project_id,
      graph_version_id,
      area_node_id,
      area_revision_id
    )
    references project_intelligence.version_nodes (
      organization_id,
      project_id,
      version_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint m4_milestone_areas_exact_key
    unique (
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
);

create index m4_milestone_areas_milestone_idx
  on projectceo_m4.milestone_areas (
    organization_id,
    project_id,
    milestone_id,
    package_id,
    production_package_version_id,
    baseline_id,
    graph_version_id
  );
create index m4_milestone_areas_revision_idx
  on projectceo_m4.milestone_areas (
    organization_id,
    project_id,
    graph_version_id,
    area_node_id,
    area_revision_id
  );

create table projectceo_m4.photo_evidence (
  organization_id uuid not null,
  project_id uuid not null,
  photo_evidence_id uuid not null default extensions.gen_random_uuid(),
  milestone_id uuid not null,
  package_id uuid not null,
  production_package_version_id text not null,
  baseline_id text not null,
  graph_version_id text not null,
  area_node_id text not null,
  area_revision_id text not null,
  source_id text not null,
  source_revision_id text not null,
  source_checksum bytea not null check (octet_length(source_checksum) = 32),
  storage_object_path text not null
    check (
      char_length(btrim(storage_object_path)) between 1 and 2048
      and storage_object_path = btrim(storage_object_path)
    ),
  captured_at timestamptz not null,
  protected_note text,
  note_digest bytea check (note_digest is null or octet_length(note_digest) = 32),
  registered_by_user_id uuid not null,
  registered_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, photo_evidence_id),
  constraint m4_photo_milestone_area_fkey
    foreign key (
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
    references projectceo_m4.milestone_areas (
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
    on delete restrict,
  constraint m4_photo_source_object_fkey
    foreign key (
      organization_id,
      project_id,
      source_id,
      source_checksum,
      storage_object_path
    )
    references project_intelligence.sources (
      organization_id,
      project_id,
      source_id,
      checksum,
      storage_object_path
    )
    on delete restrict,
  constraint m4_photo_source_revision_fkey
    foreign key (organization_id, project_id, source_revision_id)
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      revision_id
    )
    on delete restrict,
  constraint m4_photo_inventory_fkey
    foreign key (
      organization_id,
      project_id,
      package_id,
      source_id,
      source_revision_id,
      source_checksum
    )
    references projectceo_foundation.source_inventory_records (
      organization_id,
      project_id,
      package_id,
      logical_source_id,
      source_revision_id,
      checksum
    )
    on delete restrict,
  constraint m4_photo_actor_fkey
    foreign key (organization_id, registered_by_user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint m4_photo_note_shape_check
    check (
      (
        protected_note is null
        and note_digest is null
      )
      or (
        char_length(btrim(protected_note)) between 1 and 4000
        and protected_note = btrim(protected_note)
        and note_digest is not null
      )
    ),
  constraint m4_photo_exact_key
    unique (
      organization_id,
      project_id,
      photo_evidence_id,
      milestone_id,
      package_id,
      production_package_version_id,
      area_node_id
    )
);

create index m4_photo_milestone_area_idx
  on projectceo_m4.photo_evidence (
    organization_id,
    project_id,
    milestone_id,
    package_id,
    production_package_version_id,
    baseline_id,
    graph_version_id,
    area_node_id,
    area_revision_id
  );
create index m4_photo_source_object_idx
  on projectceo_m4.photo_evidence (
    organization_id,
    project_id,
    source_id,
    source_checksum,
    storage_object_path
  );
create index m4_photo_source_revision_idx
  on projectceo_m4.photo_evidence (
    organization_id,
    project_id,
    source_revision_id
  );
create index m4_photo_inventory_idx
  on projectceo_m4.photo_evidence (
    organization_id,
    project_id,
    package_id,
    source_id,
    source_revision_id,
    source_checksum
  );
create index m4_photo_actor_idx
  on projectceo_m4.photo_evidence (
    organization_id,
    registered_by_user_id
  );

create table projectceo_m4.photo_evidence_reviews (
  organization_id uuid not null,
  project_id uuid not null,
  photo_review_id uuid not null default extensions.gen_random_uuid(),
  photo_evidence_id uuid not null,
  milestone_id uuid not null,
  package_id uuid not null,
  production_package_version_id text not null,
  area_node_id text not null,
  decision text not null check (decision in ('accepted', 'rejected')),
  protected_reason text not null
    check (
      char_length(btrim(protected_reason)) between 1 and 4000
      and protected_reason = btrim(protected_reason)
    ),
  reason_digest bytea not null check (octet_length(reason_digest) = 32),
  reviewed_by_user_id uuid not null,
  reviewed_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, photo_review_id),
  constraint m4_photo_reviews_evidence_fkey
    foreign key (
      organization_id,
      project_id,
      photo_evidence_id,
      milestone_id,
      package_id,
      production_package_version_id,
      area_node_id
    )
    references projectceo_m4.photo_evidence (
      organization_id,
      project_id,
      photo_evidence_id,
      milestone_id,
      package_id,
      production_package_version_id,
      area_node_id
    )
    on delete restrict,
  constraint m4_photo_reviews_actor_fkey
    foreign key (organization_id, reviewed_by_user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint m4_photo_reviews_evidence_key
    unique (organization_id, project_id, photo_evidence_id),
  constraint m4_photo_reviews_accepted_key
    unique (
      organization_id,
      project_id,
      photo_review_id,
      photo_evidence_id,
      decision
    ),
  constraint m4_photo_reviews_exact_package_key
    unique (
      organization_id,
      project_id,
      photo_review_id,
      photo_evidence_id,
      package_id,
      production_package_version_id,
      decision
    )
);

create index m4_photo_reviews_evidence_idx
  on projectceo_m4.photo_evidence_reviews (
    organization_id,
    project_id,
    photo_evidence_id,
    milestone_id,
    package_id,
    production_package_version_id,
    area_node_id
  );
create index m4_photo_reviews_actor_idx
  on projectceo_m4.photo_evidence_reviews (
    organization_id,
    reviewed_by_user_id
  );

-- An accepted milestone is an immutable evidence snapshot.  New photos or
-- reviews after acceptance would make the later handover disagree with that
-- exact snapshot, so the database closes the photo stream structurally.
create function projectceo_m4.reject_closed_milestone_photo_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from projectceo_m4.milestone_acceptances acceptance
    where acceptance.organization_id = new.organization_id
      and acceptance.project_id = new.project_id
      and acceptance.milestone_id = new.milestone_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'PROJECTCEO_M4_MILESTONE_CLOSED';
  end if;
  return new;
end
$function$;

create trigger m4_photo_evidence_open_milestone
before insert on projectceo_m4.photo_evidence
for each row execute function
  projectceo_m4.reject_closed_milestone_photo_mutation();

create trigger m4_photo_review_open_milestone
before insert on projectceo_m4.photo_evidence_reviews
for each row execute function
  projectceo_m4.reject_closed_milestone_photo_mutation();

create table projectceo_m4.milestone_acceptances (
  organization_id uuid not null,
  project_id uuid not null,
  milestone_acceptance_id uuid not null default extensions.gen_random_uuid(),
  milestone_id uuid not null,
  package_id uuid not null,
  production_package_version_id text not null,
  baseline_id text not null,
  graph_version_id text not null,
  semantic_content jsonb not null
    check (
      jsonb_typeof(semantic_content) = 'object'
      and not (semantic_content ?| array[
        'acceptedAt', 'acceptedBy', 'generatedAt', 'signedUrl'
      ])
    ),
  semantic_digest bytea not null check (octet_length(semantic_digest) = 32),
  accepted_by_user_id uuid not null,
  accepted_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, milestone_acceptance_id),
  constraint m4_milestone_acceptance_milestone_fkey
    foreign key (
      organization_id,
      project_id,
      milestone_id,
      package_id,
      production_package_version_id,
      baseline_id,
      graph_version_id
    )
    references projectceo_m4.milestones (
      organization_id,
      project_id,
      milestone_id,
      package_id,
      production_package_version_id,
      baseline_id,
      graph_version_id
    )
    on delete restrict,
  constraint m4_milestone_acceptance_actor_fkey
    foreign key (organization_id, accepted_by_user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint m4_milestone_acceptance_milestone_key
    unique (organization_id, project_id, milestone_id),
  constraint m4_milestone_acceptance_exact_key
    unique (
      organization_id,
      project_id,
      milestone_acceptance_id,
      milestone_id,
      package_id,
      production_package_version_id,
      semantic_digest
    )
);

create index m4_milestone_acceptance_milestone_idx
  on projectceo_m4.milestone_acceptances (
    organization_id,
    project_id,
    milestone_id,
    package_id,
    production_package_version_id,
    baseline_id,
    graph_version_id
  );
create index m4_milestone_acceptance_actor_idx
  on projectceo_m4.milestone_acceptances (
    organization_id,
    accepted_by_user_id
  );

create function projectceo_m4.validate_milestone_acceptance()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from projectceo_m4.milestone_areas ma
    where ma.organization_id = new.organization_id
      and ma.project_id = new.project_id
      and ma.milestone_id = new.milestone_id
  ) or exists (
    select 1
    from projectceo_m4.milestone_areas ma
    where ma.organization_id = new.organization_id
      and ma.project_id = new.project_id
      and ma.milestone_id = new.milestone_id
      and not exists (
        select 1
        from projectceo_m4.photo_evidence pe
        join projectceo_m4.photo_evidence_reviews pr
          on pr.organization_id = pe.organization_id
         and pr.project_id = pe.project_id
         and pr.photo_evidence_id = pe.photo_evidence_id
         and pr.decision = 'accepted'
        where pe.organization_id = ma.organization_id
          and pe.project_id = ma.project_id
          and pe.milestone_id = ma.milestone_id
          and pe.area_node_id = ma.area_node_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECTCEO_M4_MILESTONE_EVIDENCE_INCOMPLETE';
  end if;
  return null;
end
$function$;

create constraint trigger m4_milestone_acceptance_closure
after insert on projectceo_m4.milestone_acceptances
deferrable initially deferred
for each row execute function projectceo_m4.validate_milestone_acceptance();

create table projectceo_m4.handover_documents (
  organization_id uuid not null,
  project_id uuid not null,
  handover_document_id uuid not null default extensions.gen_random_uuid(),
  package_id uuid not null,
  production_package_version_id text not null,
  baseline_id text not null,
  document_kind text not null check (document_kind in (
    'acceptance_act', 'warranty', 'manual'
  )),
  source_id text not null,
  source_revision_id text not null,
  source_checksum bytea not null check (octet_length(source_checksum) = 32),
  storage_object_path text not null,
  registered_by_user_id uuid not null,
  registered_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, handover_document_id),
  constraint m4_handover_docs_package_version_fkey
    foreign key (
      organization_id,
      project_id,
      package_id,
      baseline_id,
      production_package_version_id
    )
    references projectceo_product.production_package_versions (
      organization_id,
      project_id,
      package_id,
      baseline_id,
      production_package_version_id
    )
    on delete restrict,
  constraint m4_handover_docs_source_object_fkey
    foreign key (
      organization_id,
      project_id,
      source_id,
      source_checksum,
      storage_object_path
    )
    references project_intelligence.sources (
      organization_id,
      project_id,
      source_id,
      checksum,
      storage_object_path
    )
    on delete restrict,
  constraint m4_handover_docs_source_revision_fkey
    foreign key (organization_id, project_id, source_revision_id)
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      revision_id
    )
    on delete restrict,
  constraint m4_handover_docs_inventory_fkey
    foreign key (
      organization_id,
      project_id,
      package_id,
      source_id,
      source_revision_id,
      source_checksum
    )
    references projectceo_foundation.source_inventory_records (
      organization_id,
      project_id,
      package_id,
      logical_source_id,
      source_revision_id,
      checksum
    )
    on delete restrict,
  constraint m4_handover_docs_actor_fkey
    foreign key (organization_id, registered_by_user_id)
    references project_intelligence.organization_members (
      organization_id,
      user_id
    )
    on delete restrict,
  constraint m4_handover_docs_source_key
    unique (
      organization_id,
      project_id,
      package_id,
      production_package_version_id,
      document_kind,
      source_revision_id
    ),
  constraint m4_handover_docs_exact_key
    unique (
      organization_id,
      project_id,
      handover_document_id,
      package_id,
      production_package_version_id,
      document_kind,
      source_revision_id,
      source_checksum
    )
);

create index m4_handover_docs_package_version_idx
  on projectceo_m4.handover_documents (
    organization_id,
    project_id,
    package_id,
    baseline_id,
    production_package_version_id
  );
create index m4_handover_docs_source_object_idx
  on projectceo_m4.handover_documents (
    organization_id,
    project_id,
    source_id,
    source_checksum,
    storage_object_path
  );
create index m4_handover_docs_source_revision_idx
  on projectceo_m4.handover_documents (
    organization_id,
    project_id,
    source_revision_id
  );
create index m4_handover_docs_inventory_idx
  on projectceo_m4.handover_documents (
    organization_id,
    project_id,
    package_id,
    source_id,
    source_revision_id,
    source_checksum
  );
create index m4_handover_docs_actor_idx
  on projectceo_m4.handover_documents (
    organization_id,
    registered_by_user_id
  );

create table projectceo_m4.construction_handovers (
  organization_id uuid not null,
  project_id uuid not null,
  construction_handover_id uuid not null default extensions.gen_random_uuid(),
  package_id uuid not null,
  production_package_version_id text not null,
  baseline_id text not null,
  graph_version_id text not null,
  semantic_content jsonb not null
    check (
      jsonb_typeof(semantic_content) = 'object'
      and not (semantic_content ?| array[
        'artifactId', 'generatedAt', 'jobStatus', 'signedUrl'
      ])
    ),
  semantic_digest bytea not null check (octet_length(semantic_digest) = 32),
  contract_version text not null
    check (contract_version = 'project-ceo-construction-handover/0.1'),
  hash_contract_version text not null
    check (
      hash_contract_version =
        'jsonb-recursive-sorted-object-keys-arrays-contract-order/1'
    ),
  created_by_id text not null check (created_by_id like 'system:%'),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, construction_handover_id),
  constraint m4_handovers_package_version_fkey
    foreign key (
      organization_id,
      project_id,
      package_id,
      baseline_id,
      production_package_version_id
    )
    references projectceo_product.production_package_versions (
      organization_id,
      project_id,
      package_id,
      baseline_id,
      production_package_version_id
    )
    on delete restrict,
  constraint m4_handovers_graph_fkey
    foreign key (
      organization_id,
      project_id,
      baseline_id,
      graph_version_id
    )
    references projectceo_product.project_baselines (
      organization_id,
      project_id,
      baseline_id,
      graph_version_id
    )
    on delete restrict,
  constraint m4_handovers_package_version_key
    unique (
      organization_id,
      project_id,
      package_id,
      production_package_version_id
    ),
  constraint m4_handovers_exact_key
    unique (
      organization_id,
      project_id,
      construction_handover_id,
      package_id,
      production_package_version_id,
      semantic_digest
    )
);

create index m4_handovers_package_version_idx
  on projectceo_m4.construction_handovers (
    organization_id,
    project_id,
    package_id,
    baseline_id,
    production_package_version_id
  );
create index m4_handovers_graph_idx
  on projectceo_m4.construction_handovers (
    organization_id,
    project_id,
    baseline_id,
    graph_version_id
  );

create table projectceo_m4.handover_milestone_refs (
  organization_id uuid not null,
  project_id uuid not null,
  construction_handover_id uuid not null,
  package_id uuid not null,
  production_package_version_id text not null,
  handover_semantic_digest bytea not null,
  milestone_acceptance_id uuid not null,
  milestone_id uuid not null,
  milestone_semantic_digest bytea not null,
  primary key (
    organization_id,
    project_id,
    construction_handover_id,
    milestone_acceptance_id
  ),
  constraint m4_handover_milestone_handover_fkey
    foreign key (
      organization_id,
      project_id,
      construction_handover_id,
      package_id,
      production_package_version_id,
      handover_semantic_digest
    )
    references projectceo_m4.construction_handovers (
      organization_id,
      project_id,
      construction_handover_id,
      package_id,
      production_package_version_id,
      semantic_digest
    )
    on delete restrict,
  constraint m4_handover_milestone_acceptance_fkey
    foreign key (
      organization_id,
      project_id,
      milestone_acceptance_id,
      milestone_id,
      package_id,
      production_package_version_id,
      milestone_semantic_digest
    )
    references projectceo_m4.milestone_acceptances (
      organization_id,
      project_id,
      milestone_acceptance_id,
      milestone_id,
      package_id,
      production_package_version_id,
      semantic_digest
    )
    on delete restrict
);

create index m4_handover_milestone_handover_idx
  on projectceo_m4.handover_milestone_refs (
    organization_id,
    project_id,
    construction_handover_id,
    package_id,
    production_package_version_id,
    handover_semantic_digest
  );
create index m4_handover_milestone_acceptance_idx
  on projectceo_m4.handover_milestone_refs (
    organization_id,
    project_id,
    milestone_acceptance_id,
    milestone_id,
    package_id,
    production_package_version_id,
    milestone_semantic_digest
  );

create table projectceo_m4.handover_photo_refs (
  organization_id uuid not null,
  project_id uuid not null,
  construction_handover_id uuid not null,
  package_id uuid not null,
  production_package_version_id text not null,
  handover_semantic_digest bytea not null,
  photo_review_id uuid not null,
  photo_evidence_id uuid not null,
  decision text not null check (decision = 'accepted'),
  primary key (
    organization_id,
    project_id,
    construction_handover_id,
    photo_evidence_id
  ),
  constraint m4_handover_photo_handover_fkey
    foreign key (
      organization_id,
      project_id,
      construction_handover_id,
      package_id,
      production_package_version_id,
      handover_semantic_digest
    )
    references projectceo_m4.construction_handovers (
      organization_id,
      project_id,
      construction_handover_id,
      package_id,
      production_package_version_id,
      semantic_digest
    )
    on delete restrict,
  constraint m4_handover_photo_review_fkey
    foreign key (
      organization_id,
      project_id,
      photo_review_id,
      photo_evidence_id,
      package_id,
      production_package_version_id,
      decision
    )
    references projectceo_m4.photo_evidence_reviews (
      organization_id,
      project_id,
      photo_review_id,
      photo_evidence_id,
      package_id,
      production_package_version_id,
      decision
    )
    on delete restrict
);

create index m4_handover_photo_handover_idx
  on projectceo_m4.handover_photo_refs (
    organization_id,
    project_id,
    construction_handover_id,
    package_id,
    production_package_version_id,
    handover_semantic_digest
  );
create index m4_handover_photo_review_idx
  on projectceo_m4.handover_photo_refs (
    organization_id,
    project_id,
    photo_review_id,
    photo_evidence_id,
    package_id,
    production_package_version_id,
    decision
  );

create table projectceo_m4.handover_document_refs (
  organization_id uuid not null,
  project_id uuid not null,
  construction_handover_id uuid not null,
  package_id uuid not null,
  production_package_version_id text not null,
  handover_semantic_digest bytea not null,
  handover_document_id uuid not null,
  document_kind text not null,
  source_revision_id text not null,
  source_checksum bytea not null,
  primary key (
    organization_id,
    project_id,
    construction_handover_id,
    handover_document_id
  ),
  constraint m4_handover_doc_handover_fkey
    foreign key (
      organization_id,
      project_id,
      construction_handover_id,
      package_id,
      production_package_version_id,
      handover_semantic_digest
    )
    references projectceo_m4.construction_handovers (
      organization_id,
      project_id,
      construction_handover_id,
      package_id,
      production_package_version_id,
      semantic_digest
    )
    on delete restrict,
  constraint m4_handover_doc_source_fkey
    foreign key (
      organization_id,
      project_id,
      handover_document_id,
      package_id,
      production_package_version_id,
      document_kind,
      source_revision_id,
      source_checksum
    )
    references projectceo_m4.handover_documents (
      organization_id,
      project_id,
      handover_document_id,
      package_id,
      production_package_version_id,
      document_kind,
      source_revision_id,
      source_checksum
    )
    on delete restrict
);

create index m4_handover_doc_handover_idx
  on projectceo_m4.handover_document_refs (
    organization_id,
    project_id,
    construction_handover_id,
    package_id,
    production_package_version_id,
    handover_semantic_digest
  );
create index m4_handover_doc_source_idx
  on projectceo_m4.handover_document_refs (
    organization_id,
    project_id,
    handover_document_id,
    package_id,
    production_package_version_id,
    document_kind,
    source_revision_id,
    source_checksum
  );

create function projectceo_m4.validate_handover_closure()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from projectceo_m4.handover_milestone_refs hmr
    where hmr.organization_id = new.organization_id
      and hmr.project_id = new.project_id
      and hmr.construction_handover_id = new.construction_handover_id
  ) or exists (
    select 1
    from projectceo_m4.milestones m
    where m.organization_id = new.organization_id
      and m.project_id = new.project_id
      and m.package_id = new.package_id
      and m.production_package_version_id =
        new.production_package_version_id
      and not exists (
        select 1
        from projectceo_m4.milestone_acceptances ma
        join projectceo_m4.handover_milestone_refs hmr
          on hmr.organization_id = ma.organization_id
         and hmr.project_id = ma.project_id
         and hmr.milestone_acceptance_id = ma.milestone_acceptance_id
         and hmr.construction_handover_id =
           new.construction_handover_id
        where ma.organization_id = m.organization_id
          and ma.project_id = m.project_id
          and ma.milestone_id = m.milestone_id
      )
  ) or not exists (
    select 1
    from projectceo_m4.handover_document_refs hdr
    where hdr.organization_id = new.organization_id
      and hdr.project_id = new.project_id
      and hdr.construction_handover_id = new.construction_handover_id
      and hdr.document_kind = 'warranty'
  ) or exists (
    select 1
    from projectceo_m4.photo_evidence_reviews review
    join projectceo_m4.photo_evidence photo
      on photo.organization_id = review.organization_id
     and photo.project_id = review.project_id
     and photo.photo_evidence_id = review.photo_evidence_id
    where review.organization_id = new.organization_id
      and review.project_id = new.project_id
      and review.decision = 'accepted'
      and photo.package_id = new.package_id
      and photo.production_package_version_id =
        new.production_package_version_id
      and not exists (
        select 1
        from projectceo_m4.handover_photo_refs hpr
        where hpr.organization_id = review.organization_id
          and hpr.project_id = review.project_id
          and hpr.construction_handover_id =
            new.construction_handover_id
          and hpr.photo_review_id = review.photo_review_id
          and hpr.photo_evidence_id = review.photo_evidence_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'PROJECTCEO_M4_HANDOVER_CLOSURE_INCOMPLETE';
  end if;
  return null;
end
$function$;

create constraint trigger m4_construction_handover_closure
after insert on projectceo_m4.construction_handovers
deferrable initially deferred
for each row execute function projectceo_m4.validate_handover_closure();

-- A changed decision/selection package is not production-safe until its exact
-- baseline transition has a deterministic impact run and every impact has a
-- human disposition.  This is intentionally a release gate on the immutable
-- production package, not an application-only convention.
create function projectceo_m4.validate_product_release_impact_review()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_previous_baseline_id text;
  v_previous_semantic_content jsonb;
begin
  if new.previous_version_id is null then
    return new;
  end if;

  select previous.baseline_id, previous.semantic_content
  into v_previous_baseline_id, v_previous_semantic_content
  from projectceo_product.production_package_versions previous
  where previous.organization_id = new.organization_id
    and previous.project_id = new.project_id
    and previous.package_id = new.package_id
    and previous.production_package_version_id = new.previous_version_id;

  if not found then
    return new;
  end if;

  if coalesce(
       new.semantic_content #> '{exactRevisionRefs,decisions}',
       '[]'::jsonb
     ) is not distinct from coalesce(
       v_previous_semantic_content #> '{exactRevisionRefs,decisions}',
       '[]'::jsonb
     )
     and coalesce(
       new.semantic_content #> '{exactRevisionRefs,selections}',
       '[]'::jsonb
     ) is not distinct from coalesce(
       v_previous_semantic_content #> '{exactRevisionRefs,selections}',
       '[]'::jsonb
     ) then
    return new;
  end if;

  if not exists (
    select 1
    from projectceo_m4.change_requests request
    join projectceo_m4.impact_runs run
      on run.organization_id = request.organization_id
     and run.project_id = request.project_id
     and run.change_request_id = request.change_request_id
     and run.package_id = request.package_id
     and run.target_baseline_id = request.proposed_baseline_id
    where request.organization_id = new.organization_id
      and request.project_id = new.project_id
      and request.package_id = new.package_id
      and request.from_baseline_id = v_previous_baseline_id
      and request.proposed_baseline_id = new.baseline_id
      and request.from_production_package_version_id =
        new.previous_version_id
      and not exists (
        select 1
        from projectceo_m4.change_request_roots root
        where root.organization_id = request.organization_id
          and root.project_id = request.project_id
          and root.change_request_id = request.change_request_id
          and not exists (
            select 1
            from projectceo_m4.impacts root_impact
            where root_impact.organization_id = run.organization_id
              and root_impact.project_id = run.project_id
              and root_impact.impact_run_id = run.impact_run_id
              and root_impact.changed_node_id = root.node_id
              and root_impact.changed_revision_id = root.to_revision_id
          )
      )
      and not exists (
        select 1
        from projectceo_m4.impacts impact
        where impact.organization_id = run.organization_id
          and impact.project_id = run.project_id
          and impact.impact_run_id = run.impact_run_id
          and not exists (
            select 1
            from projectceo_m4.impact_reviews review
            where review.organization_id = impact.organization_id
              and review.project_id = impact.project_id
              and review.impact_run_id = impact.impact_run_id
              and review.impact_id = impact.impact_id
          )
      )
  ) then
    perform projectceo_product._raise(
      'P1110',
      'invalid_transition',
      '{"reason":"HUMAN_REVIEWED_IMPACT_REQUIRED"}'::jsonb
    );
  end if;

  return new;
end
$function$;

create trigger m4_product_release_impact_review
before insert on projectceo_product.production_package_versions
for each row execute function
  projectceo_m4.validate_product_release_impact_review();

create function projectceo_m4.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'PROJECTCEO_M4_APPEND_ONLY';
end
$function$;

do $append_only$
declare
  v_table text;
begin
  foreach v_table in array array[
    'change_requests',
    'change_request_roots',
    'impact_runs',
    'impacts',
    'impact_path_steps',
    'impact_reviews',
    'milestones',
    'milestone_areas',
    'photo_evidence',
    'photo_evidence_reviews',
    'milestone_acceptances',
    'handover_documents',
    'construction_handovers',
    'handover_milestone_refs',
    'handover_photo_refs',
    'handover_document_refs'
  ]
  loop
    execute format(
      'create trigger %I before update or delete on projectceo_m4.%I '
      || 'for each row execute function '
      || 'projectceo_m4.reject_append_only_mutation()',
      v_table || '_append_only',
      v_table
    );
  end loop;
end
$append_only$;

do $table_security$
declare
  v_table text;
begin
  for v_table in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'projectceo_m4'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table projectceo_m4.%I owner to pi_table_owner',
      v_table
    );
    execute format(
      'alter table projectceo_m4.%I enable row level security',
      v_table
    );
    execute format(
      'alter table projectceo_m4.%I force row level security',
      v_table
    );
    execute format(
      'revoke all on table projectceo_m4.%I '
      || 'from public, anon, authenticated, service_role, '
      || 'pi_human_executor, pi_worker_executor',
      v_table
    );
    execute format(
      'create policy %I on projectceo_m4.%I '
      || 'for all to pi_table_owner using (true) with check (true)',
      v_table || '_internal_owner',
      v_table
    );
  end loop;
end
$table_security$;

alter function projectceo_m4.validate_milestone_acceptance()
  owner to pi_table_owner;
alter function projectceo_m4.validate_handover_closure()
  owner to pi_table_owner;
alter function projectceo_m4.reject_closed_milestone_photo_mutation()
  owner to pi_table_owner;
alter function projectceo_m4.validate_product_release_impact_review()
  owner to pi_table_owner;
alter function projectceo_m4.reject_append_only_mutation()
  owner to pi_table_owner;

revoke all on all functions in schema projectceo_m4
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

commit;
