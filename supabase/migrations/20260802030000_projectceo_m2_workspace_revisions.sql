-- Additive M2 workspace foundation.
-- Rooms, variants, material records, budget frames and client handoffs share
-- one immutable revision ledger so every surface has the same supersession,
-- provenance and request-bound audit semantics as decisions/selections.

begin;

alter table projectceo_foundation.project_member_capabilities
  drop constraint project_member_capabilities_capability_check;
alter table projectceo_foundation.project_member_capabilities
  add constraint project_member_capabilities_capability_check
  check (capability in (
    'view_project', 'manage_project', 'manage_access', 'register_source',
    'review_source', 'review_claim', 'create_selection', 'review_selection',
    'publish_baseline', 'publish_release', 'distribute_release',
    'acknowledge_release', 'revise_decision', 'create_change',
    'review_change_impact', 'upload_photo_evidence', 'review_milestone',
    'view_audit', 'manage_budget', 'prepare_client_handoff'
  ));

create or replace function projectceo_foundation._role_capabilities(p_role text)
returns table (capability text)
language sql
immutable
set search_path = ''
as $function$
  select value
  from unnest(
    case p_role
      when 'owner_lead' then array[
        'view_project', 'manage_project', 'manage_access', 'register_source',
        'review_source', 'review_claim', 'create_selection', 'review_selection',
        'publish_baseline', 'publish_release', 'distribute_release',
        'acknowledge_release', 'revise_decision', 'create_change',
        'review_change_impact', 'upload_photo_evidence', 'review_milestone',
        'view_audit', 'manage_budget', 'prepare_client_handoff'
      ]::text[]
      when 'architect' then array[
        'view_project', 'register_source', 'review_source', 'review_claim',
        'create_selection', 'review_selection', 'publish_baseline',
        'publish_release', 'distribute_release', 'acknowledge_release',
        'revise_decision', 'create_change', 'review_change_impact',
        'upload_photo_evidence', 'review_milestone', 'view_audit',
        'manage_budget', 'prepare_client_handoff'
      ]::text[]
      when 'builder' then array[
        'view_project', 'register_source', 'acknowledge_release',
        'create_change', 'upload_photo_evidence'
      ]::text[]
      when 'client_approver' then array[
        'view_project', 'review_selection', 'acknowledge_release',
        'create_change', 'review_milestone'
      ]::text[]
      else array[]::text[]
    end
  ) value
$function$;

alter function projectceo_foundation._role_capabilities(text)
  owner to pi_table_owner;

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
    'm2_room_revision_appended',
    'm2_variant_revision_appended',
    'm2_material_revision_appended',
    'm2_budget_revision_appended',
    'm2_client_handoff_revision_appended'
  ));

create table projectceo_product.m2_workspace_revisions (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  entity_kind text not null check (entity_kind in (
    'room', 'variant', 'material', 'budget', 'client_handoff'
  )),
  entity_id text not null check (
    char_length(btrim(entity_id)) between 1 and 160
    and entity_id = btrim(entity_id)
  ),
  revision_id text not null check (
    char_length(btrim(revision_id)) between 1 and 160
    and revision_id = btrim(revision_id)
  ),
  revision_no bigint not null check (revision_no between 1 and 9007199254740991),
  supersedes_revision_id text,
  status text not null check (status in ('draft', 'submitted', 'approved', 'ready')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  reason text not null check (
    char_length(btrim(reason)) between 3 and 4000
    and reason = btrim(reason)
  ),
  reason_digest bytea not null check (octet_length(reason_digest) = 32),
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, entity_kind, entity_id, revision_id),
  constraint m2_workspace_revisions_package_fkey foreign key
    (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (organization_id, project_id, id)
    on delete restrict,
  constraint m2_workspace_revisions_project_fkey foreign key
    (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint m2_workspace_revisions_supersedes_fkey foreign key
    (organization_id, project_id, entity_kind, entity_id, supersedes_revision_id)
    references projectceo_product.m2_workspace_revisions
      (organization_id, project_id, entity_kind, entity_id, revision_id)
    on delete restrict,
  constraint m2_workspace_revisions_version_key unique
    (organization_id, project_id, entity_kind, entity_id, revision_no),
  constraint m2_workspace_revisions_lineage_shape_check check (
    (revision_no = 1 and supersedes_revision_id is null)
    or (revision_no > 1 and supersedes_revision_id is not null)
  )
);

create index m2_workspace_revisions_latest_idx
  on projectceo_product.m2_workspace_revisions
    (organization_id, project_id, entity_kind, entity_id, revision_no desc);

create trigger m2_workspace_revisions_append_only
before update or delete on projectceo_product.m2_workspace_revisions
for each row execute function projectceo_product.reject_append_only_mutation();

alter table projectceo_product.m2_workspace_revisions owner to pi_table_owner;
alter table projectceo_product.m2_workspace_revisions enable row level security;
alter table projectceo_product.m2_workspace_revisions force row level security;
revoke all on table projectceo_product.m2_workspace_revisions
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy m2_workspace_revisions_internal_owner
on projectceo_product.m2_workspace_revisions
for all to pi_table_owner using (true) with check (true);

create function projectceo_product_api.append_m2_workspace_revision(
  project_id uuid,
  package_id uuid,
  entity_kind text,
  entity_id text,
  revision_id text,
  expected_revision_id text,
  status text,
  payload jsonb,
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
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_current record;
  v_revision_no bigint;
  v_operation text;
  v_event_type text;
  v_result jsonb;
  v_capability text;
begin
  if entity_kind not in ('room', 'variant', 'material', 'budget', 'client_handoff') then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"entityKind"}'::jsonb);
  end if;
  if status not in ('draft', 'submitted')
     or (entity_kind <> 'client_handoff' and status <> 'draft')
     or (entity_kind = 'client_handoff' and status <> 'submitted') then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"status"}'::jsonb);
  end if;
  if jsonb_typeof(payload) <> 'object' then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"payload"}'::jsonb);
  end if;
  perform projectceo_product._assert_text(entity_id, 'entityId', 160);
  perform projectceo_product._assert_text(revision_id, 'revisionId', 160);
  perform projectceo_product._assert_text(reason, 'reason', 4000);
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  v_capability := case entity_kind
    when 'budget' then 'manage_budget'
    when 'client_handoff' then 'prepare_client_handoff'
    else 'revise_decision'
  end;
  select * into v_context
  from projectceo_foundation._authorize_package_human(project_id, package_id, v_capability);

  if entity_kind = 'room' and (payload->>'name' is null or payload->>'areaM2' is null) then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"ROOM_PAYLOAD_INVALID"}'::jsonb);
  elsif entity_kind = 'variant' and (payload->>'roomId' is null or payload->>'title' is null) then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"VARIANT_PAYLOAD_INVALID"}'::jsonb);
  elsif entity_kind = 'material' and (payload->>'variantId' is null or payload->>'name' is null) then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"MATERIAL_PAYLOAD_INVALID"}'::jsonb);
  elsif entity_kind = 'budget' and (payload->>'minRub' is null or payload->>'maxRub' is null) then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"BUDGET_PAYLOAD_INVALID"}'::jsonb);
  elsif entity_kind = 'client_handoff' and payload->>'approvalPackageId' is null then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"HANDOFF_PAYLOAD_INVALID"}'::jsonb);
  end if;
  if entity_kind = 'client_handoff' and not exists (
    select 1
    from projectceo_product.approval_package_events event
    where event.organization_id = v_context.organization_id
      and event.project_id = project_id
      and event.approval_package_id = payload->>'approvalPackageId'
      and event.to_status = 'approved'
      and event.sequence_no = (
        select max(latest.sequence_no)
        from projectceo_product.approval_package_events latest
        where latest.organization_id = event.organization_id
          and latest.project_id = event.project_id
          and latest.approval_package_id = event.approval_package_id
      )
  ) then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"HANDOFF_APPROVAL_REQUIRED"}'::jsonb);
  end if;

  v_operation := 'append_m2_' || entity_kind || '_revision';
  v_event_type := 'm2_' || entity_kind || '_revision_appended';
  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'entityId', entity_id, 'entityKind', entity_kind, 'expectedRevisionId', expected_revision_id,
    'expectedStateRevision', expected_state_revision, 'packageId', package_id,
    'payload', payload, 'projectId', project_id, 'reason', reason,
    'revisionId', revision_id, 'status', status
  ));
  select pw.state_revision into v_state_revision
  from project_intelligence.project_workflows pw
  where pw.organization_id = v_context.organization_id and pw.project_id = project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id, project_id, v_operation, v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentStateRevision', v_state_revision));
  end if;

  select * into v_current
  from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = v_context.organization_id
    and revision.project_id = project_id
    and revision.entity_kind = append_m2_workspace_revision.entity_kind
    and revision.entity_id = append_m2_workspace_revision.entity_id
  order by revision.revision_no desc limit 1 for update;
  if v_current is null then
    v_revision_no := 1;
  else
    if v_current.revision_id is distinct from expected_revision_id then
      perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentRevisionId', v_current.revision_id));
    end if;
    v_revision_no := v_current.revision_no + 1;
  end if;
  insert into projectceo_product.m2_workspace_revisions (
    organization_id, project_id, package_id, entity_kind, entity_id, revision_id,
    revision_no, supersedes_revision_id, status, payload, reason, reason_digest,
    created_by_user_id
  ) values (
    v_context.organization_id, project_id, package_id, entity_kind, entity_id, revision_id,
    v_revision_no, case when v_current is null then null else v_current.revision_id end,
    status, payload, reason, project_intelligence._sha256_text(reason), v_context.actor_user_id
  );
  v_result := jsonb_build_object(
    'entityKind', entity_kind, 'entityId', entity_id, 'revisionId', revision_id,
    'revisionNo', v_revision_no, 'packageId', package_id, 'status', status
  );
  return projectceo_product._complete_command(
    v_context.organization_id, project_id, v_operation, v_key_digest, v_request_digest,
    'human', v_context.actor_id, v_context.actor_user_id, v_result, v_event_type,
    jsonb_build_object('entity_kind', entity_kind, 'entity_id', entity_id, 'revision_no', v_revision_no),
    v_state_revision
  );
end
$function$;

alter function projectceo_product_api.append_m2_workspace_revision(
  uuid, uuid, text, text, text, text, text, jsonb, text, bigint, text
) owner to pi_table_owner;
revoke all on function projectceo_product_api.append_m2_workspace_revision(
  uuid, uuid, text, text, text, text, text, jsonb, text, bigint, text
) from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
grant execute on function projectceo_product_api.append_m2_workspace_revision(
  uuid, uuid, text, text, text, text, text, jsonb, text, bigint, text
) to authenticated;

commit;
