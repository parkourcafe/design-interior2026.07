-- ProjectCEO RU Product Brain relational hardening.
--
-- The Product Brain command layer already validates these exact relationships.
-- This additive migration also makes them structural database invariants so a
-- future owner-only maintenance path cannot accidentally cross a node,
-- package, baseline, artifact, version, semantic hash, or recipient boundary.

begin;

set local check_function_bodies = on;

alter table projectceo_product.claim_revision_descriptors
  add constraint claim_revision_descriptors_node_revision_key
  unique (organization_id, project_id, node_id, revision_id);

alter table projectceo_product.claim_revision_descriptors
  add constraint claim_revision_descriptors_replaces_node_fkey
  foreign key (
    organization_id,
    project_id,
    node_id,
    replaces_revision_id
  )
  references projectceo_product.claim_revision_descriptors (
    organization_id,
    project_id,
    node_id,
    revision_id
  )
  on delete restrict;

create index claim_revision_descriptors_replaces_node_idx
  on projectceo_product.claim_revision_descriptors (
    organization_id,
    project_id,
    node_id,
    replaces_revision_id
  )
  where replaces_revision_id is not null;

alter table projectceo_product.production_package_versions
  add constraint production_package_versions_package_version_key
  unique (
    organization_id,
    project_id,
    package_id,
    production_package_version_id
  );

alter table projectceo_product.production_package_versions
  add constraint production_package_versions_version_baseline_key
  unique (
    organization_id,
    project_id,
    production_package_version_id,
    baseline_id
  );

alter table projectceo_product.production_package_versions
  add constraint production_package_versions_package_baseline_version_key
  unique (
    organization_id,
    project_id,
    package_id,
    baseline_id,
    production_package_version_id
  );

alter table projectceo_product.production_package_versions
  add constraint production_package_versions_previous_package_fkey
  foreign key (
    organization_id,
    project_id,
    package_id,
    previous_version_id
  )
  references projectceo_product.production_package_versions (
    organization_id,
    project_id,
    package_id,
    production_package_version_id
  )
  on delete restrict;

alter table projectceo_product.production_package_versions
  add constraint production_package_versions_baseline_package_fkey
  foreign key (
    organization_id,
    project_id,
    baseline_id,
    package_id
  )
  references projectceo_product.project_baseline_packages (
    organization_id,
    project_id,
    baseline_id,
    package_id
  )
  on delete restrict;

create index production_package_versions_previous_package_idx
  on projectceo_product.production_package_versions (
    organization_id,
    project_id,
    package_id,
    previous_version_id
  )
  where previous_version_id is not null;

create index production_package_versions_baseline_package_idx
  on projectceo_product.production_package_versions (
    organization_id,
    project_id,
    baseline_id,
    package_id
  );

alter table projectceo_product.production_package_version_refs
  add constraint production_package_version_refs_exact_baseline_fkey
  foreign key (
    organization_id,
    project_id,
    production_package_version_id,
    baseline_id
  )
  references projectceo_product.production_package_versions (
    organization_id,
    project_id,
    production_package_version_id,
    baseline_id
  )
  on delete restrict;

create index production_package_version_refs_exact_baseline_idx
  on projectceo_product.production_package_version_refs (
    organization_id,
    project_id,
    production_package_version_id,
    baseline_id
  );

alter table projectceo_product.release_artifacts
  add constraint release_artifacts_exact_tuple_key
  unique (
    organization_id,
    project_id,
    artifact_id,
    package_id,
    production_package_version_id,
    semantic_digest
  );

alter table projectceo_product.release_artifacts
  add constraint release_artifacts_exact_package_version_fkey
  foreign key (
    organization_id,
    project_id,
    package_id,
    production_package_version_id
  )
  references projectceo_product.production_package_versions (
    organization_id,
    project_id,
    package_id,
    production_package_version_id
  )
  on delete restrict;

alter table projectceo_product.release_distributions
  add constraint release_distributions_exact_tuple_key
  unique (
    organization_id,
    project_id,
    distribution_id,
    package_id,
    production_package_version_id,
    artifact_semantic_digest,
    recipient_user_id
  );

alter table projectceo_product.release_distributions
  add constraint release_distributions_exact_artifact_fkey
  foreign key (
    organization_id,
    project_id,
    artifact_id,
    package_id,
    production_package_version_id,
    artifact_semantic_digest
  )
  references projectceo_product.release_artifacts (
    organization_id,
    project_id,
    artifact_id,
    package_id,
    production_package_version_id,
    semantic_digest
  )
  on delete restrict;

create index release_distributions_exact_artifact_idx
  on projectceo_product.release_distributions (
    organization_id,
    project_id,
    artifact_id,
    package_id,
    production_package_version_id,
    artifact_semantic_digest
  );

alter table projectceo_product.release_acknowledgements
  add constraint release_acknowledgements_exact_distribution_fkey
  foreign key (
    organization_id,
    project_id,
    distribution_id,
    package_id,
    production_package_version_id,
    artifact_semantic_digest,
    acknowledged_by_user_id
  )
  references projectceo_product.release_distributions (
    organization_id,
    project_id,
    distribution_id,
    package_id,
    production_package_version_id,
    artifact_semantic_digest,
    recipient_user_id
  )
  on delete restrict;

create index release_acknowledgements_exact_distribution_idx
  on projectceo_product.release_acknowledgements (
    organization_id,
    project_id,
    distribution_id,
    package_id,
    production_package_version_id,
    artifact_semantic_digest,
    acknowledged_by_user_id
  );

alter table projectceo_product.no_change_terminals
  add constraint no_change_terminals_exact_package_version_fkey
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
  on delete restrict;

create index no_change_terminals_exact_package_version_idx
  on projectceo_product.no_change_terminals (
    organization_id,
    project_id,
    package_id,
    baseline_id,
    production_package_version_id
  );

commit;
