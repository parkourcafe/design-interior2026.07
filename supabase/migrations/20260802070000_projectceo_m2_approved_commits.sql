-- Add exact, immutable Approved Design Intent / Approved Selections snapshots
-- to the existing request-bound M2 revision ledger.

begin;

alter table projectceo_product.m2_workspace_revisions
  drop constraint m2_workspace_revisions_entity_kind_check;
alter table projectceo_product.m2_workspace_revisions
  add constraint m2_workspace_revisions_entity_kind_check
  check (entity_kind in (
    'room', 'variant', 'material', 'budget', 'client_handoff', 'approved_commit'
  ));

alter table projectceo_product.command_records
  drop constraint command_records_operation_check;
alter table projectceo_product.command_records
  add constraint command_records_operation_check
  check (operation in (
    'append_decision_revision', 'append_selection_revision',
    'append_system_decision_revision', 'append_system_selection_revision',
    'append_price_observation', 'create_approval_package',
    'submit_approval_package', 'review_approval_package',
    'publish_project_baseline', 'publish_production_package_version',
    'build_release_artifact', 'distribute_release', 'acknowledge_release',
    'distribute_release_request_bound', 'acknowledge_release_request_bound',
    'approve_no_change', 'submit_change_request', 'calculate_change_impact',
    'review_change_impact', 'define_milestone', 'register_photo_evidence',
    'review_photo_evidence', 'accept_milestone', 'register_handover_document',
    'build_construction_handover', 'append_m2_room_revision',
    'append_m2_variant_revision', 'append_m2_material_revision',
    'append_m2_budget_revision', 'append_m2_client_handoff_revision',
    'append_m2_approved_commit_revision'
  ));

alter table projectceo_product.audit_events
  drop constraint audit_events_event_type_check;
alter table projectceo_product.audit_events
  add constraint audit_events_event_type_check
  check (event_type in (
    'decision_revision_appended', 'selection_revision_appended',
    'price_observation_appended', 'approval_package_created',
    'approval_package_submitted', 'approval_package_reviewed',
    'project_baseline_published', 'production_package_version_published',
    'release_artifact_built', 'release_distributed', 'release_acknowledged',
    'no_change_approved', 'change_request_submitted', 'change_impact_calculated',
    'change_impact_reviewed', 'milestone_defined', 'photo_evidence_registered',
    'photo_evidence_reviewed', 'milestone_accepted',
    'handover_document_registered', 'construction_handover_built',
    'm2_room_revision_appended', 'm2_variant_revision_appended',
    'm2_material_revision_appended', 'm2_budget_revision_appended',
    'm2_client_handoff_revision_appended',
    'm2_approved_commit_revision_appended'
  ));

create or replace function projectceo_product_api.append_m2_workspace_revision(
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
  v_payload_keys text[];
  v_chosen_keys text[];
  v_budget_keys text[];
  v_submitted_at timestamptz;
  v_reviewed_at timestamptz;
  v_budget_as_of timestamptz;
  v_authoritative_submitted_at timestamptz;
  v_authoritative_reviewed_at timestamptz;
  v_authoritative_review_reason text;
  v_authoritative_reviewer_user_id uuid;
begin
  if entity_kind not in (
    'room', 'variant', 'material', 'budget', 'client_handoff', 'approved_commit'
  ) then
    perform projectceo_product._raise('P1111', 'validation_failed', '{"field":"entityKind"}'::jsonb);
  end if;
  if status not in ('draft', 'submitted', 'approved')
     or (entity_kind not in ('client_handoff', 'approved_commit') and status <> 'draft')
     or (entity_kind = 'client_handoff' and status <> 'submitted')
     or (entity_kind = 'approved_commit' and status <> 'approved') then
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
    when 'approved_commit' then 'review_selection'
    else 'revise_decision'
  end;
  select * into v_context
  from projectceo_foundation._authorize_package_human(
    project_id, package_id, v_capability
  );

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
  elsif entity_kind = 'approved_commit' then
    select array_agg(key order by key) into v_payload_keys
    from jsonb_object_keys(payload) key;
    if v_payload_keys is distinct from array[
      'approvalPackageId', 'approvedSelectionRevisionIds', 'budget',
      'chosenVariant', 'designIntentRevisionId', 'reviewReason', 'reviewedAt',
      'roomId', 'submissionReason', 'submittedAt'
    ]::text[] then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVED_COMMIT_KEYS_INVALID"}'::jsonb);
    end if;
    if jsonb_typeof(payload->'chosenVariant') <> 'object'
       or jsonb_typeof(payload->'approvedSelectionRevisionIds') <> 'array'
       or jsonb_typeof(payload->'budget') <> 'object' then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVED_COMMIT_SHAPE_INVALID"}'::jsonb);
    end if;
    select array_agg(key order by key) into v_chosen_keys
    from jsonb_object_keys(payload->'chosenVariant') key;
    if v_chosen_keys is distinct from array[
      'layoutDocumentId', 'layoutVersionId', 'role', 'semanticHash', 'variantId'
    ]::text[]
       or payload#>>'{chosenVariant,role}' not in ('preferred', 'value_engineered', 'premium')
       or payload#>>'{chosenVariant,semanticHash}' !~ '^sha256:[0-9a-f]{64}$' then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVED_LAYOUT_INVALID"}'::jsonb);
    end if;
    perform projectceo_product._assert_text(payload->>'approvalPackageId', 'approvalPackageId', 160);
    perform projectceo_product._assert_text(payload->>'roomId', 'roomId', 160);
    perform projectceo_product._assert_text(payload->>'designIntentRevisionId', 'designIntentRevisionId', 160);
    perform projectceo_product._assert_text(payload#>>'{chosenVariant,variantId}', 'variantId', 160);
    perform projectceo_product._assert_text(payload#>>'{chosenVariant,layoutDocumentId}', 'layoutDocumentId', 160);
    perform projectceo_product._assert_text(payload#>>'{chosenVariant,layoutVersionId}', 'layoutVersionId', 160);
    -- submissionReason is a committer-supplied note; sequence_no 2 has no reason.
    perform projectceo_product._assert_text(payload->>'submissionReason', 'submissionReason', 4000);
    perform projectceo_product._assert_text(payload->>'reviewReason', 'reviewReason', 4000);
    perform projectceo_product._assert_text(payload->>'submittedAt', 'submittedAt', 80);
    perform projectceo_product._assert_text(payload->>'reviewedAt', 'reviewedAt', 80);
    perform projectceo_product._assert_text(payload#>>'{budget,asOf}', 'asOf', 80);
    -- Canonical accepted branch: ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$
    if payload->>'submittedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
       or payload->>'reviewedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
       or payload#>>'{budget,asOf}' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVAL_TIMESTAMP_INVALID"}'::jsonb);
    end if;
    if jsonb_array_length(payload->'approvedSelectionRevisionIds') < 1
       or jsonb_array_length(payload->'approvedSelectionRevisionIds') > 500
       or exists (
         select 1 from jsonb_array_elements(payload->'approvedSelectionRevisionIds') item
         where jsonb_typeof(item) <> 'string' or item#>>'{}' <> btrim(item#>>'{}')
            or char_length(item#>>'{}') not between 1 and 160
       )
       or (select count(*) from jsonb_array_elements_text(payload->'approvedSelectionRevisionIds'))
          <> (select count(distinct item) from jsonb_array_elements_text(payload->'approvedSelectionRevisionIds') item) then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVED_SELECTIONS_INVALID"}'::jsonb);
    end if;
    select array_agg(key order by key) into v_budget_keys
    from jsonb_object_keys(payload->'budget') key;
    if v_budget_keys is distinct from array[
      'amountRub', 'asOf', 'missingPriceSelectionRevisionIds',
      'staleAfterDays', 'staleSelectionRevisionIds'
    ]::text[]
       or jsonb_typeof(payload#>'{budget,staleSelectionRevisionIds}') <> 'array'
       or jsonb_typeof(payload#>'{budget,missingPriceSelectionRevisionIds}') <> 'array'
       or jsonb_array_length(payload#>'{budget,staleSelectionRevisionIds}') <> 0
       or jsonb_array_length(payload#>'{budget,missingPriceSelectionRevisionIds}') <> 0
       or jsonb_typeof(payload#>'{budget,amountRub}') <> 'number'
       or (payload#>>'{budget,amountRub}')::numeric < 0
       or (payload#>>'{budget,amountRub}')::numeric > 9007199254740991
       or trunc((payload#>>'{budget,amountRub}')::numeric) <> (payload#>>'{budget,amountRub}')::numeric
       or jsonb_typeof(payload#>'{budget,staleAfterDays}') <> 'number'
       or (payload#>>'{budget,staleAfterDays}')::numeric < 1
       or (payload#>>'{budget,staleAfterDays}')::numeric > 9007199254740991
       or trunc((payload#>>'{budget,staleAfterDays}')::numeric) <> (payload#>>'{budget,staleAfterDays}')::numeric then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVED_BUDGET_INVALID"}'::jsonb);
    end if;
    begin
      v_submitted_at := (payload->>'submittedAt')::timestamptz;
      v_reviewed_at := (payload->>'reviewedAt')::timestamptz;
      v_budget_as_of := (payload#>>'{budget,asOf}')::timestamptz;
      if not isfinite(v_submitted_at) or not isfinite(v_reviewed_at)
         or not isfinite(v_budget_as_of)
         or (payload->>'reviewedAt')::timestamptz < (payload->>'submittedAt')::timestamptz then
        perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVAL_CHRONOLOGY_INVALID"}'::jsonb);
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVAL_TIMESTAMP_INVALID"}'::jsonb);
    end;

    if not exists (
      select 1
      from projectceo_product.approval_packages approval
      where approval.organization_id = v_context.organization_id
        and approval.project_id = project_id
        and approval.package_id = package_id
        and approval.approval_package_id = payload->>'approvalPackageId'
    ) then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVED_COMMIT_PACKAGE_INVALID"}'::jsonb);
    end if;

    if exists (
      (select item.revision_id
       from projectceo_product.approval_package_items item
       where item.organization_id = v_context.organization_id
         and item.project_id = project_id
         and item.approval_package_id = payload->>'approvalPackageId'
         and item.target_kind = 'selection_revision'
       except
       select jsonb_array_elements_text(payload->'approvedSelectionRevisionIds'))
      union all
      (select jsonb_array_elements_text(payload->'approvedSelectionRevisionIds')
       except
       select item.revision_id
       from projectceo_product.approval_package_items item
       where item.organization_id = v_context.organization_id
         and item.project_id = project_id
         and item.approval_package_id = payload->>'approvalPackageId'
         and item.target_kind = 'selection_revision')
    ) then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVED_COMMIT_SELECTION_LINEAGE_INVALID"}'::jsonb);
    end if;

    select event.occurred_at into v_authoritative_submitted_at
    from projectceo_product.approval_package_events event
    where event.organization_id = v_context.organization_id
      and event.project_id = project_id
      and event.approval_package_id = payload->>'approvalPackageId'
      and event.sequence_no = 2
      and event.to_status = 'submitted';

    select event.occurred_at, event.reason, event.actor_user_id
      into v_authoritative_reviewed_at, v_authoritative_review_reason,
        v_authoritative_reviewer_user_id
    from projectceo_product.approval_package_events event
    where event.organization_id = v_context.organization_id
      and event.project_id = project_id
      and event.approval_package_id = payload->>'approvalPackageId'
      and event.to_status = 'approved'
      and event.self_approved = false
      and event.actor_user_id <> (
        select approval.created_by_user_id
        from projectceo_product.approval_packages approval
        where approval.organization_id = v_context.organization_id
          and approval.project_id = project_id
          and approval.package_id = package_id
          and approval.approval_package_id = payload->>'approvalPackageId'
      )
      and event.sequence_no = (
        select max(latest.sequence_no)
        from projectceo_product.approval_package_events latest
        where latest.organization_id = event.organization_id
          and latest.project_id = event.project_id
          and latest.approval_package_id = event.approval_package_id
      );

    if v_authoritative_submitted_at is null
       or v_authoritative_reviewed_at is null
       or v_authoritative_reviewer_user_id is null then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVED_COMMIT_APPROVAL_REQUIRED"}'::jsonb);
    end if;

    if (payload->>'submittedAt')::timestamptz is distinct from v_authoritative_submitted_at
       or (payload->>'reviewedAt')::timestamptz is distinct from v_authoritative_reviewed_at
       or payload->>'reviewReason' is distinct from v_authoritative_review_reason then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVED_COMMIT_PROVENANCE_MISMATCH"}'::jsonb);
    end if;

    if v_context.actor_user_id is distinct from v_authoritative_reviewer_user_id then
      perform projectceo_product._raise('P1111', 'validation_failed', '{"reason":"APPROVED_COMMIT_REVIEWER_MISMATCH"}'::jsonb);
    end if;
  end if;

  if entity_kind = 'client_handoff' and not exists (
    select 1 from projectceo_product.approval_package_events event
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
    'entityId', entity_id, 'entityKind', entity_kind,
    'expectedRevisionId', expected_revision_id,
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
    if expected_revision_id is not null then
      perform projectceo_product._raise('P1107', 'stale_state', '{"currentRevisionId":null}'::jsonb);
    end if;
    v_revision_no := 1;
  else
    if v_current.package_id is distinct from package_id then
      perform projectceo_product._raise('P1107', 'stale_state', '{"reason":"CROSS_PACKAGE_LINEAGE"}'::jsonb);
    end if;
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
    v_context.organization_id, project_id, package_id, entity_kind, entity_id,
    revision_id, v_revision_no,
    case when v_current is null then null else v_current.revision_id end,
    status, payload, reason, project_intelligence._sha256_text(reason),
    v_context.actor_user_id
  );
  v_result := jsonb_build_object(
    'entityKind', entity_kind, 'entityId', entity_id, 'revisionId', revision_id,
    'revisionNo', v_revision_no, 'packageId', package_id, 'status', status
  );
  return projectceo_product._complete_command(
    v_context.organization_id, project_id, v_operation, v_key_digest,
    v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    v_result, v_event_type,
    jsonb_build_object('entity_kind', entity_kind, 'entity_id', entity_id,
      'revision_no', v_revision_no),
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

create function projectceo_read_api.get_project_workspace_read_v4(
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
  v_base jsonb;
  v_organization_id uuid;
  v_actor_user_id uuid;
  v_role text;
  v_financial boolean := false;
  v_rows jsonb;
begin
  v_base := projectceo_read_api.get_project_workspace_read_v3(project_id, package_id);
  if v_base -> 'error' is not null and v_base -> 'error' <> 'null'::jsonb then
    return v_base;
  end if;
  v_organization_id := (v_base #>> '{scope,organizationId}')::uuid;
  v_actor_user_id := (v_base #>> '{scope,actorUserId}')::uuid;
  select membership.role into v_role
  from projectceo_foundation.project_memberships membership
  where membership.organization_id = v_organization_id
    and membership.project_id = get_project_workspace_read_v4.project_id
    and membership.user_id = v_actor_user_id
    and membership.status = 'active'
  limit 1;
  v_financial := v_role in ('owner_lead', 'architect');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', revision.entity_id, 'packageId', revision.package_id,
    'revisionId', revision.revision_id, 'revisionNo', revision.revision_no,
    'status', revision.status,
    'payload', case when v_financial then revision.payload
      else revision.payload #- '{budget,amountRub}' end,
    'createdAt', revision.created_at
  ) order by revision.entity_id), '[]'::jsonb)
  into v_rows
  from (
    select distinct on (revision.entity_kind, revision.entity_id)
      revision.entity_id, revision.package_id, revision.revision_id,
      revision.revision_no, revision.status, revision.payload, revision.created_at
    from projectceo_product.m2_workspace_revisions revision
    where revision.organization_id = v_organization_id
      and revision.project_id = get_project_workspace_read_v4.project_id
      and (get_project_workspace_read_v4.package_id is null
        or revision.package_id = get_project_workspace_read_v4.package_id)
      and revision.entity_kind = 'approved_commit'
      and revision.status = 'approved'
    order by revision.entity_kind, revision.entity_id, revision.revision_no desc
  ) revision;
  return jsonb_set(v_base, '{data,m2ApprovedCommits}', v_rows, true);
end
$function$;

alter function projectceo_read_api.get_project_workspace_read_v4(uuid, uuid)
  owner to pi_table_owner;
revoke all on function projectceo_read_api.get_project_workspace_read_v4(uuid, uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
grant execute on function projectceo_read_api.get_project_workspace_read_v4(uuid, uuid)
  to authenticated;

commit;
