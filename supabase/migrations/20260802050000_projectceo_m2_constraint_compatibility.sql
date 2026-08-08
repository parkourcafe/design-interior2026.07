-- Compatibility repair for the additive M2 revision ledger.
-- The preceding M2 migration must not narrow the existing M1/M3/M4 command
-- and audit operation vocabulary. Rebuild both checks as the complete union.

begin;

create index if not exists m2_workspace_revisions_created_by_user_idx
  on projectceo_product.m2_workspace_revisions (created_by_user_id);
create index if not exists m2_workspace_revisions_package_idx
  on projectceo_product.m2_workspace_revisions
    (organization_id, project_id, package_id);
create index if not exists m2_workspace_revisions_supersedes_idx
  on projectceo_product.m2_workspace_revisions
    (organization_id, project_id, entity_kind, entity_id, supersedes_revision_id);

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
    'build_construction_handover',
    'append_m2_room_revision',
    'append_m2_variant_revision',
    'append_m2_material_revision',
    'append_m2_budget_revision',
    'append_m2_client_handoff_revision'
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
    'construction_handover_built',
    'm2_room_revision_appended',
    'm2_variant_revision_appended',
    'm2_material_revision_appended',
    'm2_budget_revision_appended',
    'm2_client_handoff_revision_appended'
  ));

commit;
