-- ProjectCEO RU Product Brain durable persistence.
--
-- Additive local candidate only. This migration extends the frozen DB2 graph
-- kinds with explicit Selection identity and creates private M2/M3 + release
-- persistence. It does not apply or backfill production data.

begin;

set local check_function_bodies = on;

create schema projectceo_product authorization pi_table_owner;
create schema projectceo_product_api authorization pi_table_owner;

revoke all on schema projectceo_product
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on schema projectceo_product_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

alter default privileges for role pi_table_owner
  in schema projectceo_product
  revoke all on tables from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema projectceo_product_api
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema projectceo_product
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Selection is a first-class graph identity. It is never encoded as Item,
-- Room/Area, Deliverable or Approval.
alter table project_intelligence.graph_nodes
  drop constraint graph_nodes_kind_check;
alter table project_intelligence.graph_nodes
  add constraint graph_nodes_kind_check
  check (kind in (
    'area',
    'source',
    'requirement',
    'assumption',
    'decision',
    'selection',
    'risk',
    'deliverable',
    'item',
    'approval'
  ));

-- Product revisions retain the explicit human-origin state while preserving
-- the immutable DB2 revision identity and version snapshot machinery.
alter table project_intelligence.graph_node_revisions
  drop constraint graph_node_revisions_claim_status_check;
alter table project_intelligence.graph_node_revisions
  add constraint graph_node_revisions_claim_status_check
  check (claim_status in (
    'extracted',
    'interpreted',
    'unknown',
    'human_origin'
  ));

alter table project_intelligence.version_nodes
  add constraint version_nodes_exact_version_revision_key
  unique (
    organization_id,
    project_id,
    version_id,
    node_id,
    revision_id
  );

-- Preserve the DB2 trigger contract: private constraint triggers remain
-- SECURITY INVOKER. Product commands flush the deferred closure while their
-- NOLOGIN executor is still the effective SECURITY DEFINER role.
alter function project_intelligence.validate_revision_evidence()
  security invoker;
alter function project_intelligence.validate_revision_evidence()
  set search_path = '';
alter function project_intelligence.validate_revision_evidence()
  owner to pi_table_owner;
revoke all
  on function project_intelligence.validate_revision_evidence()
  from public, anon, authenticated, service_role;

create table projectceo_product.claim_revision_descriptors (
  organization_id uuid not null,
  project_id uuid not null,
  revision_id text not null
    check (
      char_length(btrim(revision_id)) between 1 and 160
      and revision_id = btrim(revision_id)
    ),
  node_id text not null
    check (
      char_length(btrim(node_id)) between 1 and 160
      and node_id = btrim(node_id)
    ),
  kind text not null check (kind in ('decision', 'selection')),
  revision_no bigint not null
    check (revision_no between 1 and 9007199254740991),
  replaces_revision_id text,
  package_id uuid not null,
  area_node_id text,
  decision_revision_id text,
  review_status text not null default 'draft'
    check (review_status in ('draft', 'submitted')),
  reason text not null
    check (
      char_length(btrim(reason)) between 1 and 4000
      and reason = btrim(reason)
    ),
  reason_digest bytea not null check (octet_length(reason_digest) = 32),
  created_by_type text not null check (created_by_type in ('human', 'system')),
  created_by_user_id uuid,
  created_by_id text not null
    check (
      char_length(btrim(created_by_id)) between 1 and 160
      and created_by_id = btrim(created_by_id)
    ),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, revision_id),
  constraint claim_revision_descriptors_graph_revision_fkey
    foreign key (organization_id, project_id, node_id, revision_id)
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint claim_revision_descriptors_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint claim_revision_descriptors_area_fkey
    foreign key (organization_id, project_id, area_node_id)
    references project_intelligence.graph_nodes (
      organization_id,
      project_id,
      node_id
    )
    on delete restrict,
  constraint claim_revision_descriptors_replaces_fkey
    foreign key (
      organization_id,
      project_id,
      replaces_revision_id
    )
    references projectceo_product.claim_revision_descriptors (
      organization_id,
      project_id,
      revision_id
    )
    on delete restrict,
  constraint claim_revision_descriptors_decision_fkey
    foreign key (
      organization_id,
      project_id,
      decision_revision_id
    )
    references projectceo_product.claim_revision_descriptors (
      organization_id,
      project_id,
      revision_id
    )
    on delete restrict,
  constraint claim_revision_descriptors_actor_fkey
    foreign key (created_by_user_id)
    references auth.users (id)
    on delete restrict,
  constraint claim_revision_descriptors_shape_check
    check (
      (
        kind = 'decision'
        and decision_revision_id is null
      )
      or (
        kind = 'selection'
        and area_node_id is not null
        and decision_revision_id is not null
      )
    ),
  constraint claim_revision_descriptors_actor_shape_check
    check (
      (
        created_by_type = 'human'
        and created_by_user_id is not null
        and created_by_id = created_by_user_id::text
      )
      or (
        created_by_type = 'system'
        and created_by_user_id is null
        and created_by_id like 'system:%'
      )
    ),
  constraint claim_revision_descriptors_revision_shape_check
    check (
      (
        revision_no = 1
        and replaces_revision_id is null
      )
      or (
        revision_no > 1
        and replaces_revision_id is not null
      )
    ),
  constraint claim_revision_descriptors_not_own_replacement_check
    check (
      replaces_revision_id is null
      or replaces_revision_id <> revision_id
    ),
  constraint claim_revision_descriptors_kind_revision_key
    unique (organization_id, project_id, kind, revision_id),
  constraint claim_revision_descriptors_node_revision_no_key
    unique (organization_id, project_id, node_id, revision_no)
);

create index claim_revision_descriptors_package_idx
  on projectceo_product.claim_revision_descriptors (
    organization_id,
    project_id,
    package_id,
    kind,
    created_at desc
  );
create index claim_revision_descriptors_graph_revision_idx
  on projectceo_product.claim_revision_descriptors (
    organization_id,
    project_id,
    node_id,
    revision_id
  );
create index claim_revision_descriptors_area_idx
  on projectceo_product.claim_revision_descriptors (
    organization_id,
    project_id,
    area_node_id
  )
  where area_node_id is not null;
create index claim_revision_descriptors_replaces_idx
  on projectceo_product.claim_revision_descriptors (
    organization_id,
    project_id,
    replaces_revision_id
  )
  where replaces_revision_id is not null;
create index claim_revision_descriptors_decision_idx
  on projectceo_product.claim_revision_descriptors (
    organization_id,
    project_id,
    decision_revision_id
  )
  where decision_revision_id is not null;
create index claim_revision_descriptors_actor_idx
  on projectceo_product.claim_revision_descriptors (created_by_user_id)
  where created_by_user_id is not null;

create table projectceo_product.revision_evidence_refs (
  organization_id uuid not null,
  project_id uuid not null,
  claim_revision_id text not null,
  evidence_version_id text not null,
  evidence_link_id text not null,
  source_id text not null,
  source_node_id text not null,
  source_revision_id text not null,
  fragment_id text not null,
  ordinal bigint not null
    check (ordinal between 0 and 9007199254740991),
  created_at timestamptz not null default statement_timestamp(),
  primary key (
    organization_id,
    project_id,
    claim_revision_id,
    evidence_link_id
  ),
  constraint revision_evidence_refs_claim_fkey
    foreign key (organization_id, project_id, claim_revision_id)
    references projectceo_product.claim_revision_descriptors (
      organization_id,
      project_id,
      revision_id
    )
    on delete restrict,
  constraint revision_evidence_refs_version_evidence_fkey
    foreign key (
      organization_id,
      project_id,
      evidence_version_id,
      evidence_link_id
    )
    references project_intelligence.version_evidence_links (
      organization_id,
      project_id,
      version_id,
      evidence_link_id
    )
    on delete restrict,
  constraint revision_evidence_refs_version_source_fkey
    foreign key (
      organization_id,
      project_id,
      evidence_version_id,
      source_id
    )
    references project_intelligence.version_sources (
      organization_id,
      project_id,
      version_id,
      source_id
    )
    on delete restrict,
  constraint revision_evidence_refs_version_fragment_fkey
    foreign key (
      organization_id,
      project_id,
      evidence_version_id,
      fragment_id
    )
    references project_intelligence.version_source_fragments (
      organization_id,
      project_id,
      version_id,
      fragment_id
    )
    on delete restrict,
  constraint revision_evidence_refs_version_source_revision_fkey
    foreign key (
      organization_id,
      project_id,
      evidence_version_id,
      source_node_id,
      source_revision_id
    )
    references project_intelligence.version_nodes (
      organization_id,
      project_id,
      version_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint revision_evidence_refs_exact_source_revision_fkey
    foreign key (
      organization_id,
      project_id,
      source_node_id,
      source_revision_id
    )
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint revision_evidence_refs_evidence_link_fkey
    foreign key (
      organization_id,
      project_id,
      evidence_link_id
    )
    references project_intelligence.evidence_links (
      organization_id,
      project_id,
      evidence_link_id
    )
    on delete restrict,
  constraint revision_evidence_refs_source_fkey
    foreign key (organization_id, project_id, source_id)
    references project_intelligence.sources (
      organization_id,
      project_id,
      source_id
    )
    on delete restrict,
  constraint revision_evidence_refs_fragment_fkey
    foreign key (organization_id, project_id, fragment_id)
    references project_intelligence.source_fragments (
      organization_id,
      project_id,
      fragment_id
    )
    on delete restrict,
  constraint revision_evidence_refs_ordinal_key
    unique (
      organization_id,
      project_id,
      claim_revision_id,
      ordinal
    )
);

create index revision_evidence_refs_version_evidence_idx
  on projectceo_product.revision_evidence_refs (
    organization_id,
    project_id,
    evidence_version_id,
    evidence_link_id
  );
create index revision_evidence_refs_version_source_idx
  on projectceo_product.revision_evidence_refs (
    organization_id,
    project_id,
    evidence_version_id,
    source_id
  );
create index revision_evidence_refs_version_fragment_idx
  on projectceo_product.revision_evidence_refs (
    organization_id,
    project_id,
    evidence_version_id,
    fragment_id
  );
create index revision_evidence_refs_version_source_revision_idx
  on projectceo_product.revision_evidence_refs (
    organization_id,
    project_id,
    evidence_version_id,
    source_node_id,
    source_revision_id
  );
create index revision_evidence_refs_source_revision_idx
  on projectceo_product.revision_evidence_refs (
    organization_id,
    project_id,
    source_node_id,
    source_revision_id
  );
create index revision_evidence_refs_evidence_idx
  on projectceo_product.revision_evidence_refs (
    organization_id,
    project_id,
    evidence_link_id
  );
create index revision_evidence_refs_source_idx
  on projectceo_product.revision_evidence_refs (
    organization_id,
    project_id,
    source_id
  );
create index revision_evidence_refs_fragment_idx
  on projectceo_product.revision_evidence_refs (
    organization_id,
    project_id,
    fragment_id
  );

create table projectceo_product.price_observations (
  organization_id uuid not null,
  project_id uuid not null,
  observation_id text not null
    check (
      char_length(btrim(observation_id)) between 1 and 160
      and observation_id = btrim(observation_id)
    ),
  selection_revision_id text not null,
  amount_rub bigint not null
    check (amount_rub between 0 and 9007199254740991),
  evidence_version_id text not null,
  evidence_link_id text not null,
  source_id text not null,
  source_node_id text not null,
  source_revision_id text not null,
  fragment_id text not null,
  supplier_ref text
    check (
      supplier_ref is null
      or (
        char_length(btrim(supplier_ref)) between 1 and 500
        and supplier_ref = btrim(supplier_ref)
      )
    ),
  observed_by_user_id uuid not null,
  observed_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, observation_id),
  constraint price_observations_selection_fkey
    foreign key (
      organization_id,
      project_id,
      selection_revision_id
    )
    references projectceo_product.claim_revision_descriptors (
      organization_id,
      project_id,
      revision_id
    )
    on delete restrict,
  constraint price_observations_version_evidence_fkey
    foreign key (
      organization_id,
      project_id,
      evidence_version_id,
      evidence_link_id
    )
    references project_intelligence.version_evidence_links (
      organization_id,
      project_id,
      version_id,
      evidence_link_id
    )
    on delete restrict,
  constraint price_observations_version_source_fkey
    foreign key (
      organization_id,
      project_id,
      evidence_version_id,
      source_id
    )
    references project_intelligence.version_sources (
      organization_id,
      project_id,
      version_id,
      source_id
    )
    on delete restrict,
  constraint price_observations_version_fragment_fkey
    foreign key (
      organization_id,
      project_id,
      evidence_version_id,
      fragment_id
    )
    references project_intelligence.version_source_fragments (
      organization_id,
      project_id,
      version_id,
      fragment_id
    )
    on delete restrict,
  constraint price_observations_version_source_revision_fkey
    foreign key (
      organization_id,
      project_id,
      evidence_version_id,
      source_node_id,
      source_revision_id
    )
    references project_intelligence.version_nodes (
      organization_id,
      project_id,
      version_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint price_observations_source_revision_fkey
    foreign key (
      organization_id,
      project_id,
      source_node_id,
      source_revision_id
    )
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint price_observations_evidence_link_fkey
    foreign key (
      organization_id,
      project_id,
      evidence_link_id
    )
    references project_intelligence.evidence_links (
      organization_id,
      project_id,
      evidence_link_id
    )
    on delete restrict,
  constraint price_observations_source_fkey
    foreign key (organization_id, project_id, source_id)
    references project_intelligence.sources (
      organization_id,
      project_id,
      source_id
    )
    on delete restrict,
  constraint price_observations_fragment_fkey
    foreign key (organization_id, project_id, fragment_id)
    references project_intelligence.source_fragments (
      organization_id,
      project_id,
      fragment_id
    )
    on delete restrict,
  constraint price_observations_actor_fkey
    foreign key (observed_by_user_id)
    references auth.users (id)
    on delete restrict
);

create index price_observations_selection_idx
  on projectceo_product.price_observations (
    organization_id,
    project_id,
    selection_revision_id,
    observed_at desc
  );
create index price_observations_version_evidence_idx
  on projectceo_product.price_observations (
    organization_id,
    project_id,
    evidence_version_id,
    evidence_link_id
  );
create index price_observations_version_source_idx
  on projectceo_product.price_observations (
    organization_id,
    project_id,
    evidence_version_id,
    source_id
  );
create index price_observations_version_fragment_idx
  on projectceo_product.price_observations (
    organization_id,
    project_id,
    evidence_version_id,
    fragment_id
  );
create index price_observations_version_source_revision_idx
  on projectceo_product.price_observations (
    organization_id,
    project_id,
    evidence_version_id,
    source_node_id,
    source_revision_id
  );
create index price_observations_source_revision_idx
  on projectceo_product.price_observations (
    organization_id,
    project_id,
    source_node_id,
    source_revision_id
  );
create index price_observations_evidence_idx
  on projectceo_product.price_observations (
    organization_id,
    project_id,
    evidence_link_id
  );
create index price_observations_source_idx
  on projectceo_product.price_observations (
    organization_id,
    project_id,
    source_id
  );
create index price_observations_fragment_idx
  on projectceo_product.price_observations (
    organization_id,
    project_id,
    fragment_id
  );
create index price_observations_actor_idx
  on projectceo_product.price_observations (observed_by_user_id);

create table projectceo_product.approval_packages (
  organization_id uuid not null,
  project_id uuid not null,
  approval_package_id text not null
    check (
      char_length(btrim(approval_package_id)) between 1 and 160
      and approval_package_id = btrim(approval_package_id)
    ),
  package_id uuid not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, approval_package_id),
  constraint approval_packages_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint approval_packages_actor_fkey
    foreign key (created_by_user_id)
    references auth.users (id)
    on delete restrict
);

create index approval_packages_package_idx
  on projectceo_product.approval_packages (
    organization_id,
    project_id,
    package_id,
    created_at desc
  );
create index approval_packages_actor_idx
  on projectceo_product.approval_packages (created_by_user_id);

create table projectceo_product.approval_package_items (
  organization_id uuid not null,
  project_id uuid not null,
  approval_package_id text not null,
  target_kind text not null check (target_kind in (
    'requirement_revision',
    'assumption_revision',
    'decision_revision',
    'selection_revision'
  )),
  entity_id text not null
    check (
      char_length(btrim(entity_id)) between 1 and 160
      and entity_id = btrim(entity_id)
    ),
  revision_id text not null
    check (
      char_length(btrim(revision_id)) between 1 and 160
      and revision_id = btrim(revision_id)
    ),
  ordinal bigint not null
    check (ordinal between 0 and 9007199254740991),
  primary key (
    organization_id,
    project_id,
    approval_package_id,
    target_kind,
    revision_id
  ),
  constraint approval_package_items_package_fkey
    foreign key (
      organization_id,
      project_id,
      approval_package_id
    )
    references projectceo_product.approval_packages (
      organization_id,
      project_id,
      approval_package_id
    )
    on delete restrict,
  constraint approval_package_items_revision_fkey
    foreign key (
      organization_id,
      project_id,
      entity_id,
      revision_id
    )
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint approval_package_items_ordinal_key
    unique (
      organization_id,
      project_id,
      approval_package_id,
      ordinal
    )
);

create index approval_package_items_revision_idx
  on projectceo_product.approval_package_items (
    organization_id,
    project_id,
    entity_id,
    revision_id
  );

create table projectceo_product.approval_package_events (
  organization_id uuid not null,
  project_id uuid not null,
  approval_package_id text not null,
  event_id uuid not null default extensions.gen_random_uuid(),
  sequence_no bigint not null
    check (sequence_no between 1 and 9007199254740991),
  from_status text,
  to_status text not null check (to_status in (
    'draft',
    'submitted',
    'approved',
    'rejected',
    'change_requested'
  )),
  actor_user_id uuid not null,
  reason text,
  reason_digest bytea,
  occurred_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, event_id),
  constraint approval_package_events_package_fkey
    foreign key (
      organization_id,
      project_id,
      approval_package_id
    )
    references projectceo_product.approval_packages (
      organization_id,
      project_id,
      approval_package_id
    )
    on delete restrict,
  constraint approval_package_events_actor_fkey
    foreign key (actor_user_id)
    references auth.users (id)
    on delete restrict,
  constraint approval_package_events_sequence_key
    unique (
      organization_id,
      project_id,
      approval_package_id,
      sequence_no
    ),
  constraint approval_package_events_terminal_key
    unique (
      organization_id,
      project_id,
      approval_package_id,
      to_status
    ),
  constraint approval_package_events_shape_check
    check (
      (
        sequence_no = 1
        and from_status is null
        and to_status = 'draft'
        and reason is null
        and reason_digest is null
      )
      or (
        sequence_no = 2
        and from_status = 'draft'
        and to_status = 'submitted'
        and reason is null
        and reason_digest is null
      )
      or (
        sequence_no = 3
        and from_status = 'submitted'
        and to_status in ('approved', 'rejected', 'change_requested')
        and reason is not null
        and char_length(btrim(reason)) between 1 and 4000
        and reason = btrim(reason)
        and reason_digest is not null
        and octet_length(reason_digest) = 32
      )
    )
);

create index approval_package_events_package_idx
  on projectceo_product.approval_package_events (
    organization_id,
    project_id,
    approval_package_id,
    sequence_no desc
  );
create index approval_package_events_actor_idx
  on projectceo_product.approval_package_events (actor_user_id);

create table projectceo_product.project_baselines (
  organization_id uuid not null,
  project_id uuid not null,
  baseline_id text not null
    check (
      char_length(btrim(baseline_id)) between 1 and 160
      and baseline_id = btrim(baseline_id)
    ),
  version_no bigint not null
    check (version_no between 1 and 9007199254740991),
  previous_baseline_id text,
  graph_version_id text not null,
  semantic_content jsonb not null
    check (
      jsonb_typeof(semantic_content) = 'object'
      and not (
        semantic_content ?| array[
          'artifactId',
          'generatedAt',
          'jobStatus',
          'signedUrl',
          'publishedAt',
          'publishedBy'
        ]
      )
    ),
  semantic_digest bytea not null check (octet_length(semantic_digest) = 32),
  published_by_user_id uuid not null,
  published_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, baseline_id),
  constraint project_baselines_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (
      organization_id,
      project_id
    )
    on delete restrict,
  constraint project_baselines_graph_version_fkey
    foreign key (organization_id, project_id, graph_version_id)
    references project_intelligence.project_versions (
      organization_id,
      project_id,
      version_id
    )
    on delete restrict,
  constraint project_baselines_previous_fkey
    foreign key (organization_id, project_id, previous_baseline_id)
    references projectceo_product.project_baselines (
      organization_id,
      project_id,
      baseline_id
    )
    on delete restrict,
  constraint project_baselines_publisher_fkey
    foreign key (published_by_user_id)
    references auth.users (id)
    on delete restrict,
  constraint project_baselines_version_key
    unique (organization_id, project_id, version_no),
  constraint project_baselines_semantic_key
    unique (organization_id, project_id, semantic_digest),
  constraint project_baselines_lineage_shape_check
    check (
      (
        version_no = 1
        and previous_baseline_id is null
      )
      or (
        version_no > 1
        and previous_baseline_id is not null
      )
    ),
  constraint project_baselines_not_own_previous_check
    check (
      previous_baseline_id is null
      or previous_baseline_id <> baseline_id
    )
);

create index project_baselines_graph_version_idx
  on projectceo_product.project_baselines (
    organization_id,
    project_id,
    graph_version_id
  );
create index project_baselines_previous_idx
  on projectceo_product.project_baselines (
    organization_id,
    project_id,
    previous_baseline_id
  )
  where previous_baseline_id is not null;
create index project_baselines_publisher_idx
  on projectceo_product.project_baselines (published_by_user_id);

create table projectceo_product.project_baseline_packages (
  organization_id uuid not null,
  project_id uuid not null,
  baseline_id text not null,
  package_id uuid not null,
  primary key (
    organization_id,
    project_id,
    baseline_id,
    package_id
  ),
  constraint project_baseline_packages_baseline_fkey
    foreign key (organization_id, project_id, baseline_id)
    references projectceo_product.project_baselines (
      organization_id,
      project_id,
      baseline_id
    )
    on delete restrict,
  constraint project_baseline_packages_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict
);

create index project_baseline_packages_package_idx
  on projectceo_product.project_baseline_packages (
    organization_id,
    project_id,
    package_id,
    baseline_id
  );

create table projectceo_product.project_baseline_refs (
  organization_id uuid not null,
  project_id uuid not null,
  baseline_id text not null,
  target_kind text not null check (target_kind in (
    'source_revision',
    'requirement_revision',
    'assumption_revision',
    'decision_revision',
    'selection_revision'
  )),
  entity_id text not null,
  revision_id text not null,
  ordinal bigint not null
    check (ordinal between 0 and 9007199254740991),
  primary key (
    organization_id,
    project_id,
    baseline_id,
    target_kind,
    revision_id
  ),
  constraint project_baseline_refs_baseline_fkey
    foreign key (organization_id, project_id, baseline_id)
    references projectceo_product.project_baselines (
      organization_id,
      project_id,
      baseline_id
    )
    on delete restrict,
  constraint project_baseline_refs_revision_fkey
    foreign key (
      organization_id,
      project_id,
      entity_id,
      revision_id
    )
    references project_intelligence.graph_node_revisions (
      organization_id,
      project_id,
      node_id,
      revision_id
    )
    on delete restrict,
  constraint project_baseline_refs_ordinal_key
    unique (
      organization_id,
      project_id,
      baseline_id,
      target_kind,
      ordinal
    ),
  constraint project_baseline_refs_target_revision_key
    unique (
      organization_id,
      project_id,
      baseline_id,
      target_kind,
      revision_id
    )
);

create index project_baseline_refs_revision_idx
  on projectceo_product.project_baseline_refs (
    organization_id,
    project_id,
    entity_id,
    revision_id
  );

create table projectceo_product.project_baseline_approvals (
  organization_id uuid not null,
  project_id uuid not null,
  baseline_id text not null,
  approval_package_id text not null,
  primary key (
    organization_id,
    project_id,
    baseline_id,
    approval_package_id
  ),
  constraint project_baseline_approvals_baseline_fkey
    foreign key (organization_id, project_id, baseline_id)
    references projectceo_product.project_baselines (
      organization_id,
      project_id,
      baseline_id
    )
    on delete restrict,
  constraint project_baseline_approvals_package_fkey
    foreign key (
      organization_id,
      project_id,
      approval_package_id
    )
    references projectceo_product.approval_packages (
      organization_id,
      project_id,
      approval_package_id
    )
    on delete restrict
);

create index project_baseline_approvals_package_idx
  on projectceo_product.project_baseline_approvals (
    organization_id,
    project_id,
    approval_package_id
  );

create table projectceo_product.production_package_versions (
  organization_id uuid not null,
  project_id uuid not null,
  production_package_version_id text not null
    check (
      char_length(btrim(production_package_version_id)) between 1 and 160
      and production_package_version_id =
        btrim(production_package_version_id)
    ),
  package_id uuid not null,
  baseline_id text not null,
  version_no bigint not null
    check (version_no between 1 and 9007199254740991),
  previous_version_id text,
  semantic_content jsonb not null
    check (
      jsonb_typeof(semantic_content) = 'object'
      and not (
        semantic_content ?| array[
          'artifactId',
          'generatedAt',
          'jobStatus',
          'signedUrl',
          'publishedAt',
          'publishedBy'
        ]
      )
    ),
  semantic_digest bytea not null check (octet_length(semantic_digest) = 32),
  published_by_user_id uuid not null,
  published_at timestamptz not null default statement_timestamp(),
  primary key (
    organization_id,
    project_id,
    production_package_version_id
  ),
  constraint production_package_versions_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint production_package_versions_baseline_fkey
    foreign key (organization_id, project_id, baseline_id)
    references projectceo_product.project_baselines (
      organization_id,
      project_id,
      baseline_id
    )
    on delete restrict,
  constraint production_package_versions_previous_fkey
    foreign key (organization_id, project_id, previous_version_id)
    references projectceo_product.production_package_versions (
      organization_id,
      project_id,
      production_package_version_id
    )
    on delete restrict,
  constraint production_package_versions_publisher_fkey
    foreign key (published_by_user_id)
    references auth.users (id)
    on delete restrict,
  constraint production_package_versions_version_key
    unique (organization_id, project_id, package_id, version_no),
  constraint production_package_versions_semantic_key
    unique (
      organization_id,
      project_id,
      package_id,
      baseline_id,
      semantic_digest
    ),
  constraint production_package_versions_lineage_shape_check
    check (
      (
        version_no = 1
        and previous_version_id is null
      )
      or (
        version_no > 1
        and previous_version_id is not null
      )
    ),
  constraint production_package_versions_not_own_previous_check
    check (
      previous_version_id is null
      or previous_version_id <> production_package_version_id
    )
);

create index production_package_versions_package_idx
  on projectceo_product.production_package_versions (
    organization_id,
    project_id,
    package_id,
    version_no desc
  );
create index production_package_versions_baseline_idx
  on projectceo_product.production_package_versions (
    organization_id,
    project_id,
    baseline_id
  );
create index production_package_versions_previous_idx
  on projectceo_product.production_package_versions (
    organization_id,
    project_id,
    previous_version_id
  )
  where previous_version_id is not null;
create index production_package_versions_publisher_idx
  on projectceo_product.production_package_versions (published_by_user_id);

create table projectceo_product.production_package_version_refs (
  organization_id uuid not null,
  project_id uuid not null,
  production_package_version_id text not null,
  baseline_id text not null,
  target_kind text not null check (target_kind in (
    'source_revision',
    'requirement_revision',
    'assumption_revision',
    'decision_revision',
    'selection_revision'
  )),
  revision_id text not null,
  ordinal bigint not null
    check (ordinal between 0 and 9007199254740991),
  primary key (
    organization_id,
    project_id,
    production_package_version_id,
    target_kind,
    revision_id
  ),
  constraint production_package_version_refs_version_fkey
    foreign key (
      organization_id,
      project_id,
      production_package_version_id
    )
    references projectceo_product.production_package_versions (
      organization_id,
      project_id,
      production_package_version_id
    )
    on delete restrict,
  constraint production_package_version_refs_baseline_ref_fkey
    foreign key (
      organization_id,
      project_id,
      baseline_id,
      target_kind,
      revision_id
    )
    references projectceo_product.project_baseline_refs (
      organization_id,
      project_id,
      baseline_id,
      target_kind,
      revision_id
    )
    on delete restrict,
  constraint production_package_version_refs_ordinal_key
    unique (
      organization_id,
      project_id,
      production_package_version_id,
      target_kind,
      ordinal
    )
);

create index production_package_version_refs_baseline_idx
  on projectceo_product.production_package_version_refs (
    organization_id,
    project_id,
    baseline_id,
    target_kind,
    revision_id
  );

create table projectceo_product.release_artifacts (
  organization_id uuid not null,
  project_id uuid not null,
  artifact_id text not null
    check (
      char_length(btrim(artifact_id)) between 1 and 160
      and artifact_id = btrim(artifact_id)
    ),
  package_id uuid not null,
  production_package_version_id text not null,
  format text not null check (format = 'logical_json'),
  logical_content jsonb not null
    check (
      jsonb_typeof(logical_content) = 'object'
      and not (
        logical_content ?| array[
          'artifactId',
          'generatedAt',
          'jobStatus',
          'signedUrl'
        ]
      )
    ),
  semantic_digest bytea not null check (octet_length(semantic_digest) = 32),
  created_by_type text not null check (created_by_type in ('human', 'system')),
  created_by_user_id uuid,
  created_by_id text not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, artifact_id),
  constraint release_artifacts_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint release_artifacts_package_version_fkey
    foreign key (
      organization_id,
      project_id,
      production_package_version_id
    )
    references projectceo_product.production_package_versions (
      organization_id,
      project_id,
      production_package_version_id
    )
    on delete restrict,
  constraint release_artifacts_actor_fkey
    foreign key (created_by_user_id)
    references auth.users (id)
    on delete restrict,
  constraint release_artifacts_actor_shape_check
    check (
      (
        created_by_type = 'human'
        and created_by_user_id is not null
        and created_by_id = created_by_user_id::text
      )
      or (
        created_by_type = 'system'
        and created_by_user_id is null
        and created_by_id like 'system:%'
      )
    ),
  constraint release_artifacts_semantic_tuple_key
    unique (
      organization_id,
      project_id,
      package_id,
      production_package_version_id,
      format,
      semantic_digest
    )
);

create index release_artifacts_package_version_idx
  on projectceo_product.release_artifacts (
    organization_id,
    project_id,
    package_id,
    production_package_version_id,
    created_at desc
  );
create index release_artifacts_version_fk_idx
  on projectceo_product.release_artifacts (
    organization_id,
    project_id,
    production_package_version_id
  );
create index release_artifacts_actor_idx
  on projectceo_product.release_artifacts (created_by_user_id)
  where created_by_user_id is not null;

create table projectceo_product.release_distributions (
  organization_id uuid not null,
  project_id uuid not null,
  distribution_id uuid not null default extensions.gen_random_uuid(),
  package_id uuid not null,
  artifact_id text not null,
  production_package_version_id text not null,
  artifact_semantic_digest bytea not null
    check (octet_length(artifact_semantic_digest) = 32),
  recipient_user_id uuid not null,
  distributed_by_user_id uuid not null,
  distributed_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, distribution_id),
  constraint release_distributions_artifact_fkey
    foreign key (organization_id, project_id, artifact_id)
    references projectceo_product.release_artifacts (
      organization_id,
      project_id,
      artifact_id
    )
    on delete restrict,
  constraint release_distributions_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint release_distributions_package_version_fkey
    foreign key (
      organization_id,
      project_id,
      production_package_version_id
    )
    references projectceo_product.production_package_versions (
      organization_id,
      project_id,
      production_package_version_id
    )
    on delete restrict,
  constraint release_distributions_recipient_fkey
    foreign key (recipient_user_id)
    references auth.users (id)
    on delete restrict,
  constraint release_distributions_actor_fkey
    foreign key (distributed_by_user_id)
    references auth.users (id)
    on delete restrict,
  constraint release_distributions_recipient_version_key
    unique (
      organization_id,
      project_id,
      package_id,
      production_package_version_id,
      recipient_user_id
    )
);

create index release_distributions_artifact_idx
  on projectceo_product.release_distributions (
    organization_id,
    project_id,
    artifact_id
  );
create index release_distributions_package_idx
  on projectceo_product.release_distributions (
    organization_id,
    project_id,
    package_id,
    distributed_at desc
  );
create index release_distributions_package_version_idx
  on projectceo_product.release_distributions (
    organization_id,
    project_id,
    production_package_version_id
  );
create index release_distributions_recipient_idx
  on projectceo_product.release_distributions (recipient_user_id);
create index release_distributions_actor_idx
  on projectceo_product.release_distributions (distributed_by_user_id);

create table projectceo_product.release_acknowledgements (
  organization_id uuid not null,
  project_id uuid not null,
  acknowledgement_id uuid not null default extensions.gen_random_uuid(),
  distribution_id uuid not null,
  package_id uuid not null,
  production_package_version_id text not null,
  artifact_semantic_digest bytea not null
    check (octet_length(artifact_semantic_digest) = 32),
  acknowledged_by_user_id uuid not null,
  acknowledged_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, acknowledgement_id),
  constraint release_acknowledgements_distribution_fkey
    foreign key (organization_id, project_id, distribution_id)
    references projectceo_product.release_distributions (
      organization_id,
      project_id,
      distribution_id
    )
    on delete restrict,
  constraint release_acknowledgements_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint release_acknowledgements_package_version_fkey
    foreign key (
      organization_id,
      project_id,
      production_package_version_id
    )
    references projectceo_product.production_package_versions (
      organization_id,
      project_id,
      production_package_version_id
    )
    on delete restrict,
  constraint release_acknowledgements_actor_fkey
    foreign key (acknowledged_by_user_id)
    references auth.users (id)
    on delete restrict,
  constraint release_acknowledgements_distribution_key
    unique (organization_id, project_id, distribution_id),
  constraint release_acknowledgements_recipient_version_key
    unique (
      organization_id,
      project_id,
      package_id,
      production_package_version_id,
      acknowledged_by_user_id
    )
);

create index release_acknowledgements_package_idx
  on projectceo_product.release_acknowledgements (
    organization_id,
    project_id,
    package_id,
    acknowledged_at desc
  );
create index release_acknowledgements_package_version_idx
  on projectceo_product.release_acknowledgements (
    organization_id,
    project_id,
    production_package_version_id
  );
create index release_acknowledgements_actor_idx
  on projectceo_product.release_acknowledgements (
    acknowledged_by_user_id
  );

create table projectceo_product.no_change_terminals (
  organization_id uuid not null,
  project_id uuid not null,
  no_change_id uuid not null default extensions.gen_random_uuid(),
  package_id uuid not null,
  baseline_id text not null,
  production_package_version_id text not null,
  reason text not null
    check (
      char_length(btrim(reason)) between 1 and 4000
      and reason = btrim(reason)
    ),
  reason_digest bytea not null check (octet_length(reason_digest) = 32),
  approved_by_user_id uuid not null,
  approved_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, no_change_id),
  constraint no_change_terminals_package_fkey
    foreign key (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (
      organization_id,
      project_id,
      id
    )
    on delete restrict,
  constraint no_change_terminals_baseline_fkey
    foreign key (organization_id, project_id, baseline_id)
    references projectceo_product.project_baselines (
      organization_id,
      project_id,
      baseline_id
    )
    on delete restrict,
  constraint no_change_terminals_package_version_fkey
    foreign key (
      organization_id,
      project_id,
      production_package_version_id
    )
    references projectceo_product.production_package_versions (
      organization_id,
      project_id,
      production_package_version_id
    )
    on delete restrict,
  constraint no_change_terminals_actor_fkey
    foreign key (approved_by_user_id)
    references auth.users (id)
    on delete restrict,
  constraint no_change_terminals_version_key
    unique (
      organization_id,
      project_id,
      package_id,
      production_package_version_id
    )
);

create index no_change_terminals_baseline_idx
  on projectceo_product.no_change_terminals (
    organization_id,
    project_id,
    baseline_id
  );
create index no_change_terminals_package_version_idx
  on projectceo_product.no_change_terminals (
    organization_id,
    project_id,
    production_package_version_id
  );
create index no_change_terminals_actor_idx
  on projectceo_product.no_change_terminals (approved_by_user_id);

create table projectceo_product.command_records (
  command_id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  operation text not null check (operation in (
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
    'approve_no_change'
  )),
  key_digest bytea not null check (octet_length(key_digest) = 32),
  request_digest bytea not null check (octet_length(request_digest) = 32),
  actor_type text not null check (actor_type in ('human', 'system')),
  actor_id text not null,
  actor_user_id uuid,
  logical_result jsonb not null
    check (jsonb_typeof(logical_result) = 'object'),
  resulting_state_revision bigint not null
    check (resulting_state_revision between 0 and 9007199254740991),
  completed_at timestamptz not null default statement_timestamp(),
  constraint product_command_records_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (
      organization_id,
      project_id
    )
    on delete restrict,
  constraint product_command_records_actor_fkey
    foreign key (actor_user_id)
    references auth.users (id)
    on delete restrict,
  constraint product_command_records_idempotency_key
    unique (organization_id, project_id, operation, key_digest),
  constraint product_command_records_scope_id_key
    unique (organization_id, project_id, command_id),
  constraint product_command_records_actor_shape_check
    check (
      (
        actor_type = 'human'
        and actor_user_id is not null
        and actor_id = actor_user_id::text
      )
      or (
        actor_type = 'system'
        and actor_user_id is null
        and actor_id like 'system:%'
      )
    )
);

create index product_command_records_actor_idx
  on projectceo_product.command_records (actor_user_id)
  where actor_user_id is not null;

create table projectceo_product.audit_events (
  audit_event_id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  command_id uuid not null,
  event_type text not null check (event_type in (
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
    'no_change_approved'
  )),
  actor_type text not null check (actor_type in ('human', 'system')),
  actor_id text not null,
  request_id text not null
    check (
      char_length(btrim(request_id)) between 1 and 160
      and request_id = btrim(request_id)
    ),
  controlled_metadata jsonb not null
    check (
      jsonb_typeof(controlled_metadata) = 'object'
      and not (
        controlled_metadata ?| array[
          'email',
          'recipientEmail',
          'token',
          'tokenDigest',
          'originalFilename',
          'storagePath',
          'signedUrl',
          'reason'
        ]
      )
    ),
  occurred_at timestamptz not null default statement_timestamp(),
  constraint product_audit_events_project_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (
      organization_id,
      project_id
    )
    on delete restrict,
  constraint product_audit_events_command_fkey
    foreign key (organization_id, project_id, command_id)
    references projectceo_product.command_records (
      organization_id,
      project_id,
      command_id
    )
    on delete restrict
);

create index product_audit_events_project_occurred_idx
  on projectceo_product.audit_events (
    organization_id,
    project_id,
    occurred_at desc
  );
create index product_audit_events_command_idx
  on projectceo_product.audit_events (
    organization_id,
    project_id,
    command_id
  );

create function projectceo_product.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'PROJECTCEO_PRODUCT_APPEND_ONLY';
end
$function$;

do $append_only$
declare
  v_table text;
begin
  foreach v_table in array array[
    'claim_revision_descriptors',
    'revision_evidence_refs',
    'price_observations',
    'approval_packages',
    'approval_package_items',
    'approval_package_events',
    'project_baselines',
    'project_baseline_packages',
    'project_baseline_refs',
    'project_baseline_approvals',
    'production_package_versions',
    'production_package_version_refs',
    'release_artifacts',
    'release_distributions',
    'release_acknowledgements',
    'no_change_terminals',
    'command_records',
    'audit_events'
  ]
  loop
    execute format(
      'create trigger %I before update or delete on projectceo_product.%I '
      || 'for each row execute function '
      || 'projectceo_product.reject_append_only_mutation()',
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
    where n.nspname = 'projectceo_product'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table projectceo_product.%I owner to pi_table_owner',
      v_table
    );
    execute format(
      'alter table projectceo_product.%I enable row level security',
      v_table
    );
    execute format(
      'alter table projectceo_product.%I force row level security',
      v_table
    );
    execute format(
      'revoke all on table projectceo_product.%I '
      || 'from public, anon, authenticated, service_role, '
      || 'pi_human_executor, pi_worker_executor',
      v_table
    );
    execute format(
      'create policy %I on projectceo_product.%I '
      || 'for all to pi_table_owner using (true) with check (true)',
      v_table || '_internal_owner',
      v_table
    );
  end loop;
end
$table_security$;

alter function projectceo_product.reject_append_only_mutation()
  owner to pi_table_owner;

revoke all on all functions in schema projectceo_product
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

commit;
