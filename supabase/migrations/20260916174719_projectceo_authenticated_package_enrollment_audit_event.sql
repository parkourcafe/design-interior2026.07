begin;

alter table projectceo_foundation.audit_events
  drop constraint if exists audit_events_event_type_check;
alter table projectceo_foundation.audit_events
  add constraint audit_events_event_type_check check (event_type in (
    'project_enrolled', 'project_scope_enrolled',
    'invitation_created', 'invitation_accepted', 'invitation_revoked',
    'invitation_expired', 'guest_grant_created', 'guest_grant_revoked',
    'source_inventory_registered', 'source_graph_ingested'
  ));

alter function projectceo_api.enroll_organization_project_scope(uuid, uuid, text, text, jsonb, text)
  owner to pi_table_owner;

commit;
