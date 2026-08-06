begin;

-- Package-scoped client reviewers use the same bounded capability vocabulary
-- already supported for project memberships.
alter table projectceo_foundation.package_member_capabilities
  drop constraint package_member_capabilities_capability_check;
alter table projectceo_foundation.package_member_capabilities
  add constraint package_member_capabilities_capability_check check (capability in (
    'view_project','manage_project','manage_access','register_source','review_source',
    'review_claim','create_selection','review_selection','publish_baseline',
    'publish_release','distribute_release','acknowledge_release','revise_decision',
    'create_change','review_change_impact','upload_photo_evidence','review_milestone',
    'view_audit','manage_budget','prepare_client_handoff'
  ));

create or replace function projectceo_foundation._package_role_capabilities(p_role text)
returns table (capability text)
language sql
immutable
set search_path = ''
as $function$
  select value
  from unnest(
    case p_role
      when 'architect' then array[
        'view_project', 'register_source', 'acknowledge_release',
        'create_change', 'upload_photo_evidence', 'review_milestone'
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

-- Invitations accepted before this additive migration already carry the
-- client_approver role but were created from the older capability template.
insert into projectceo_foundation.package_member_capabilities (
  organization_id, project_id, package_id, user_id, capability
)
select membership.organization_id, membership.project_id,
  membership.package_id, membership.user_id, 'review_selection'
from projectceo_foundation.package_memberships membership
where membership.role = 'client_approver'
  and membership.status = 'active'
on conflict do nothing;

-- Cycle 6 extends the existing append-only M2 ledger; no mutable review table
-- or client-authored M3 snapshot is introduced.
alter table projectceo_product.m2_workspace_revisions
  drop constraint m2_workspace_revisions_entity_kind_check;
alter table projectceo_product.m2_workspace_revisions
  add constraint m2_workspace_revisions_entity_kind_check check (entity_kind in (
    'room', 'variant', 'material', 'budget', 'client_handoff',
    'approved_commit', 'layout_version', 'm2_client_submission',
    'm2_client_review', 'm2_m3_handoff'
  ));

alter table projectceo_product.command_records drop constraint command_records_operation_check;
alter table projectceo_product.command_records add constraint command_records_operation_check check (operation in (
  'append_decision_revision', 'append_selection_revision',
  'append_system_decision_revision', 'append_system_selection_revision',
  'append_price_observation', 'create_approval_package', 'submit_approval_package',
  'review_approval_package', 'publish_project_baseline', 'publish_production_package_version',
  'build_release_artifact', 'distribute_release', 'acknowledge_release',
  'distribute_release_request_bound', 'acknowledge_release_request_bound',
  'approve_no_change', 'submit_change_request', 'calculate_change_impact',
  'review_change_impact', 'define_milestone', 'register_photo_evidence',
  'review_photo_evidence', 'accept_milestone', 'register_handover_document',
  'build_construction_handover', 'append_m2_room_revision', 'append_m2_variant_revision',
  'append_m2_material_revision', 'append_m2_budget_revision',
  'append_m2_client_handoff_revision', 'append_m2_approved_commit_revision',
  'append_m2_layout_version_revision', 'submit_m2_client_review',
  'review_m2_client_submission', 'publish_m2_m3_handoff'
));

alter table projectceo_product.audit_events drop constraint audit_events_event_type_check;
alter table projectceo_product.audit_events add constraint audit_events_event_type_check check (event_type in (
  'decision_revision_appended', 'selection_revision_appended', 'price_observation_appended',
  'approval_package_created', 'approval_package_submitted', 'approval_package_reviewed',
  'project_baseline_published', 'production_package_version_published', 'release_artifact_built',
  'release_distributed', 'release_acknowledged', 'no_change_approved', 'change_request_submitted',
  'change_impact_calculated', 'change_impact_reviewed', 'milestone_defined',
  'photo_evidence_registered', 'photo_evidence_reviewed', 'milestone_accepted',
  'handover_document_registered', 'construction_handover_built', 'm2_room_revision_appended',
  'm2_variant_revision_appended', 'm2_material_revision_appended', 'm2_budget_revision_appended',
  'm2_client_handoff_revision_appended', 'm2_approved_commit_revision_appended',
  'm2_layout_version_revision_appended', 'm2_client_review_submitted',
  'm2_client_submission_reviewed', 'm2_m3_handoff_published'
));

create function projectceo_product._append_m2_cycle6_revision(
  p_context record, p_project_id uuid, p_package_id uuid, p_entity_kind text,
  p_entity_id text, p_revision_id text, p_expected_revision_id text,
  p_status text, p_payload jsonb, p_reason text, p_expected_state_revision bigint,
  p_idempotency_key text, p_operation text, p_event_type text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
#variable_conflict use_variable
declare
  v_state_revision bigint; v_key_digest bytea; v_request_digest bytea;
  v_replay jsonb; v_current record; v_revision_no bigint; v_result jsonb;
begin
  perform projectceo_product._assert_text(p_entity_id, 'entityId', 160);
  perform projectceo_product._assert_text(p_revision_id, 'revisionId', 160);
  perform projectceo_product._assert_text(p_reason, 'reason', 4000);
  perform projectceo_foundation._assert_state_revision(p_expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'projectId', p_project_id, 'packageId', p_package_id, 'entityKind', p_entity_kind,
    'entityId', p_entity_id, 'revisionId', p_revision_id,
    'expectedRevisionId', p_expected_revision_id,
    'payload', p_payload - array['submittedAt','reviewedAt','publishedAt'],
    'reason', p_reason, 'expectedStateRevision', p_expected_state_revision
  ));
  select workflow.state_revision into v_state_revision
  from project_intelligence.project_workflows workflow
  where workflow.organization_id = p_context.organization_id and workflow.project_id = p_project_id
  for update;
  v_replay := projectceo_product._replay_or_null(
    p_context.organization_id, p_project_id, p_operation, v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> p_expected_state_revision then
    perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentStateRevision', v_state_revision));
  end if;
  select * into v_current from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = p_context.organization_id and revision.project_id = p_project_id
    and revision.entity_kind = p_entity_kind and revision.entity_id = p_entity_id
  order by revision.revision_no desc limit 1 for update;
  if v_current is null then
    if p_expected_revision_id is not null then
      perform projectceo_product._raise('P1107', 'stale_state', '{"currentRevisionId":null}'::jsonb);
    end if;
    v_revision_no := 1;
  else
    if v_current.package_id is distinct from p_package_id
       or v_current.revision_id is distinct from p_expected_revision_id then
      perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentRevisionId', v_current.revision_id));
    end if;
    v_revision_no := v_current.revision_no + 1;
  end if;
  insert into projectceo_product.m2_workspace_revisions (
    organization_id, project_id, package_id, entity_kind, entity_id, revision_id,
    revision_no, supersedes_revision_id, status, payload, reason, reason_digest, created_by_user_id
  ) values (
    p_context.organization_id, p_project_id, p_package_id, p_entity_kind, p_entity_id,
    p_revision_id, v_revision_no, case when v_current is null then null else v_current.revision_id end,
    p_status, p_payload, p_reason, project_intelligence._sha256_text(p_reason), p_context.actor_user_id
  );
  v_result := jsonb_build_object('entityKind', p_entity_kind, 'entityId', p_entity_id,
    'revisionId', p_revision_id, 'revisionNo', v_revision_no, 'packageId', p_package_id, 'status', p_status);
  return projectceo_product._complete_command(
    p_context.organization_id, p_project_id, p_operation, v_key_digest, v_request_digest,
    'human', p_context.actor_id, p_context.actor_user_id, v_result, p_event_type,
    jsonb_build_object('entity_kind', p_entity_kind, 'entity_id', p_entity_id, 'revision_no', v_revision_no),
    v_state_revision
  );
end $function$;

alter function projectceo_product._append_m2_cycle6_revision(
  record,uuid,uuid,text,text,text,text,text,jsonb,text,bigint,text,text,text
) owner to pi_table_owner;
revoke all on function projectceo_product._append_m2_cycle6_revision(
  record,uuid,uuid,text,text,text,text,text,jsonb,text,bigint,text,text,text
) from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;

-- The established approved-commit API validates the canonical approval,
-- selections, budget and human provenance first. This trigger then binds the
-- already-persisted client review lineage without introducing a second write API.
create function projectceo_product._bind_m2_client_review_commit()
returns trigger language plpgsql security definer set search_path = '' as $function$
#variable_conflict use_variable
declare v_review record; v_submission record; v_variant jsonb; v_expected jsonb;
  v_approval_submitted_at timestamptz; v_approval_reviewed_at timestamptz;
  v_approval_review_reason text;
begin
  if new.entity_kind<>'approved_commit' or new.entity_id not like 'approved-%' then return new; end if;
  if exists (select 1 from projectceo_product.m2_workspace_revisions current_commit
      where current_commit.organization_id=new.organization_id
        and current_commit.project_id=new.project_id and current_commit.package_id=new.package_id
        and current_commit.entity_kind='approved_commit'
        and current_commit.entity_id=new.entity_id) then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"CLIENT_APPROVED_COMMIT_ALREADY_EXISTS"}'::jsonb);
  end if;
  select * into v_review from projectceo_product.m2_workspace_revisions review
   where review.organization_id=new.organization_id and review.project_id=new.project_id
     and review.package_id=new.package_id and review.entity_kind='m2_client_review'
     and review.entity_id=substring(new.entity_id from 10) and review.status='approved'
   order by review.revision_no desc limit 1;
  if v_review is null then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"APPROVED_CLIENT_REVIEW_REQUIRED"}'::jsonb);
  end if;
  select * into v_submission from projectceo_product.m2_workspace_revisions submission
   where submission.organization_id=new.organization_id and submission.project_id=new.project_id
     and submission.package_id=new.package_id and submission.entity_kind='m2_client_submission'
     and submission.entity_id=v_review.entity_id
     and submission.revision_id=v_review.payload->>'submissionRevisionId';
  select variant into v_variant from jsonb_array_elements(v_submission.payload->'variants') variant
   where variant->>'variantId'=v_review.payload->>'chosenVariantId';
  if v_submission is null or v_variant is null
     or new.payload#>>'{chosenVariant,variantId}' is distinct from v_review.payload->>'chosenVariantId' then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"CLIENT_REVIEW_LINEAGE_INVALID"}'::jsonb);
  end if;
  select event.occurred_at into v_approval_submitted_at
  from projectceo_product.approval_package_events event
  where event.organization_id=new.organization_id and event.project_id=new.project_id
    and event.approval_package_id=v_submission.payload->>'approvalPackageId'
    and event.sequence_no=2 and event.to_status='submitted';
  select event.occurred_at,event.reason into v_approval_reviewed_at,v_approval_review_reason
  from projectceo_product.approval_package_events event
  where event.organization_id=new.organization_id and event.project_id=new.project_id
    and event.approval_package_id=v_submission.payload->>'approvalPackageId'
    and event.to_status='approved' and event.self_approved=false
    and event.actor_user_id=v_review.created_by_user_id
  order by event.sequence_no desc limit 1;
  v_expected := jsonb_build_object(
    'approvalPackageId',v_submission.payload->>'approvalPackageId',
    'roomId',v_submission.payload->>'roomId',
    'designIntentRevisionId',v_submission.payload->>'designIntentRevisionId',
    'chosenVariant',v_variant-array['selectionRevisionIds','budget','layoutRevisionId'],
    'approvedSelectionRevisionIds',v_variant->'selectionRevisionIds',
    'budget',jsonb_build_object('asOf',v_submission.payload->>'budgetAsOf',
      'staleAfterDays',(v_submission.payload->>'staleAfterDays')::integer,
      'amountRub',v_variant#>'{budget,amountRub}',
      'staleSelectionRevisionIds',v_variant#>'{budget,staleSelectionRevisionIds}',
      'missingPriceSelectionRevisionIds',v_variant#>'{budget,missingPriceSelectionRevisionIds}'),
    'submittedAt',v_approval_submitted_at,'reviewedAt',v_approval_reviewed_at,
    'submissionReason',v_submission.payload->>'submissionReason',
    'reviewReason',v_approval_review_reason);
  if new.payload is distinct from v_expected then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"CLIENT_APPROVED_COMMIT_SNAPSHOT_MISMATCH"}'::jsonb);
  end if;
  new.payload := new.payload || jsonb_build_object('clientSubmissionId',v_review.entity_id,
    'clientReviewRevisionId',v_review.revision_id);
  new.payload := jsonb_set(new.payload,'{chosenVariant,layoutRevisionId}',
    to_jsonb(v_variant->>'layoutRevisionId'),true);
  return new;
end $function$;
alter function projectceo_product._bind_m2_client_review_commit() owner to pi_table_owner;
revoke all on function projectceo_product._bind_m2_client_review_commit()
  from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
create trigger bind_m2_client_review_commit
before insert on projectceo_product.m2_workspace_revisions
for each row execute function projectceo_product._bind_m2_client_review_commit();

create function projectceo_product_api.submit_m2_client_review(
  project_id uuid, package_id uuid, submission_id text, revision_id text,
  expected_revision_id text, approval_package_id text, room_id text,
  design_intent_revision_id text, variants jsonb, budget_as_of text,
  stale_after_days integer, reason text, expected_state_revision bigint, idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
#variable_conflict use_variable
declare v_context record; v_role text; v_client_user_id uuid; v_payload jsonb; v_variant jsonb;
  v_selection_id text; v_authoritative_amount numeric; v_submitted_amount numeric;
  v_price_count bigint;
begin
  if auth.uid() is null then perform projectceo_product._raise('P1101','unauthenticated','{}'::jsonb); end if;
  perform projectceo_product._assert_text(submission_id,'submissionId',160);
  perform projectceo_product._assert_text(revision_id,'revisionId',160);
  perform projectceo_product._assert_text(reason,'reason',4000);
  if expected_revision_id is not null or stale_after_days < 1
     or budget_as_of !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(.\d+)?(Z|[+-]\d{2}:\d{2})$'
     or jsonb_typeof(variants)<>'array' or jsonb_array_length(variants)<>3
     or not (variants @> '[{"role":"preferred"}]'::jsonb
       and variants @> '[{"role":"value_engineered"}]'::jsonb
       and variants @> '[{"role":"premium"}]'::jsonb)
     or exists (select 1 from jsonb_array_elements(variants) candidate
       where candidate->>'layoutRevisionId' is null
          or jsonb_typeof(candidate->'selectionRevisionIds') <> 'array'
          or jsonb_typeof(candidate->'budget') <> 'object'
          or not (candidate->'budget' ? 'staleSelectionRevisionIds')
          or not (candidate->'budget' ? 'missingPriceSelectionRevisionIds')) then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"M2_CLIENT_VARIANTS_INVALID"}'::jsonb);
  end if;
  select * into v_context from projectceo_foundation._authorize_package_human(project_id, package_id, 'prepare_client_handoff');
  select membership.role into v_role from projectceo_foundation.project_memberships membership
   where membership.organization_id=v_context.organization_id and membership.project_id=project_id
     and membership.user_id=v_context.actor_user_id and membership.status='active';
  if v_role not in ('owner_lead','architect') then perform projectceo_product._raise('P1103','forbidden','{}'::jsonb); end if;
  if not exists (select 1 from projectceo_product.approval_packages approval
       where approval.organization_id=v_context.organization_id and approval.project_id=project_id
         and approval.package_id=package_id and approval.approval_package_id=approval_package_id)
     or not exists (select 1 from projectceo_product.approval_package_events event
       where event.organization_id=v_context.organization_id and event.project_id=project_id
         and event.approval_package_id=approval_package_id and event.to_status='approved'
         and event.sequence_no=(select max(latest.sequence_no)
           from projectceo_product.approval_package_events latest
           where latest.organization_id=event.organization_id and latest.project_id=event.project_id
             and latest.approval_package_id=event.approval_package_id)) then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"APPROVAL_PACKAGE_INVALID"}'::jsonb);
  end if;
  if not exists (select 1 from projectceo_product.approval_package_items item
      join projectceo_product.approval_packages design_approval
        on design_approval.organization_id=item.organization_id
       and design_approval.project_id=item.project_id
       and design_approval.approval_package_id=item.approval_package_id
      join project_intelligence.graph_node_revisions revision
        on revision.organization_id=item.organization_id and revision.project_id=item.project_id
       and revision.node_id=item.entity_id and revision.revision_id=item.revision_id
      join (select graph.organization_id,graph.project_id,graph.node_id,
              graph.kind as node_type from project_intelligence.graph_nodes graph) node
        on node.organization_id=revision.organization_id and node.project_id=revision.project_id
       and node.node_id=revision.node_id and node.node_type='decision'
      where item.organization_id=v_context.organization_id and item.project_id=project_id
        and design_approval.package_id=package_id and item.target_kind='decision_revision'
        and item.revision_id=design_intent_revision_id
        and exists (select 1 from projectceo_product.approval_package_events design_event
          where design_event.organization_id=item.organization_id
            and design_event.project_id=item.project_id
            and design_event.approval_package_id=item.approval_package_id
            and design_event.to_status='approved'
            and design_event.sequence_no=(select max(latest.sequence_no)
              from projectceo_product.approval_package_events latest
              where latest.organization_id=design_event.organization_id
                and latest.project_id=design_event.project_id
                and latest.approval_package_id=design_event.approval_package_id))) then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"DESIGN_INTENT_INVALID"}'::jsonb);
  end if;
  for v_variant in select value from jsonb_array_elements(variants) loop
    if not exists (select 1 from projectceo_product.m2_workspace_revisions layout
      where layout.organization_id=v_context.organization_id and layout.project_id=project_id
        and layout.package_id=package_id and layout.entity_kind='layout_version'
        and layout.entity_id=v_variant->>'layoutDocumentId'
        and layout.revision_id=v_variant->>'layoutRevisionId' and layout.status='published'
        and layout.payload->>'versionId'=v_variant->>'layoutVersionId'
        and layout.payload->>'variantId'=v_variant->>'variantId'
        and layout.payload->>'role'=v_variant->>'role'
        and layout.payload->>'semanticHash'=v_variant->>'semanticHash') then
      perform projectceo_product._raise('P1111','validation_failed','{"reason":"LAYOUT_LINEAGE_INVALID"}'::jsonb);
    end if;
    for v_selection_id in select value from jsonb_array_elements_text(v_variant->'selectionRevisionIds') loop
      if not exists (select 1 from projectceo_product.approval_package_items item
        join project_intelligence.graph_node_revisions revision
          on revision.organization_id=item.organization_id and revision.project_id=item.project_id
         and revision.node_id=item.entity_id and revision.revision_id=item.revision_id
        join (select graph.organization_id,graph.project_id,graph.node_id,
                graph.kind as node_type from project_intelligence.graph_nodes graph) node
          on node.organization_id=revision.organization_id and node.project_id=revision.project_id
         and node.node_id=revision.node_id and node.node_type='selection'
        where item.organization_id=v_context.organization_id and item.project_id=project_id
          and item.approval_package_id=approval_package_id and item.target_kind='selection_revision'
          and item.revision_id=v_selection_id) then
        perform projectceo_product._raise('P1111','validation_failed','{"reason":"SELECTION_REVISION_INVALID"}'::jsonb);
      end if;
    end loop;
    select sum(latest.amount_rub),count(*) into v_authoritative_amount,v_price_count
    from jsonb_array_elements_text(v_variant->'selectionRevisionIds') selection_revision_id
    cross join lateral (
      select price.amount_rub
      from projectceo_product.price_observations price
      left join projectceo_product.revision_evidence_refs evidence_refs
        on evidence_refs.organization_id=price.organization_id
       and evidence_refs.project_id=price.project_id
       and evidence_refs.claim_revision_id=price.selection_revision_id
       and evidence_refs.evidence_link_id=price.evidence_link_id
      where price.organization_id=v_context.organization_id and price.project_id=project_id
        and price.selection_revision_id=selection_revision_id.value
        and price.evidence_link_id is not null and price.source_revision_id is not null
        and price.fragment_id is not null
      order by price.observed_at desc,price.observation_id collate "C" desc limit 1
    ) latest;
    if v_price_count<>jsonb_array_length(v_variant->'selectionRevisionIds') then
      perform projectceo_product._raise('P1111','validation_failed','{"reason":"PRICE_PROVENANCE_REQUIRED"}'::jsonb);
    end if;
    v_submitted_amount := (v_variant#>>'{budget,amountRub}')::numeric;
    if v_authoritative_amount < 0 or v_authoritative_amount > 9007199254740991
       or trunc(v_authoritative_amount)<>v_authoritative_amount
       or v_submitted_amount is distinct from v_authoritative_amount then
      perform projectceo_product._raise('P1111','validation_failed','{"reason":"PRICE_PROVENANCE_MISMATCH"}'::jsonb);
    end if;
  end loop;
  select membership.user_id into v_client_user_id
  from projectceo_foundation.package_memberships membership
  where membership.organization_id=v_context.organization_id and membership.project_id=project_id
    and membership.package_id=package_id and membership.role='client_approver' and membership.status='active'
  order by membership.user_id limit 1;
  if v_client_user_id is null then perform projectceo_product._raise('P1111','validation_failed','{"reason":"CLIENT_APPROVER_REQUIRED"}'::jsonb); end if;
  v_payload := jsonb_build_object('approvalPackageId',approval_package_id,'roomId',room_id,
    'designIntentRevisionId',design_intent_revision_id,'variants',variants,'budgetAsOf',budget_as_of,
    'staleAfterDays',stale_after_days,'assignedClientUserId',v_client_user_id,
    'submittedByActorUserId',v_context.actor_user_id,'submissionReason',reason,
    'submittedAt',statement_timestamp());
  return projectceo_product._append_m2_cycle6_revision(v_context,project_id,package_id,
    'm2_client_submission',submission_id,revision_id,expected_revision_id,'submitted',v_payload,
    reason,expected_state_revision,idempotency_key,'submit_m2_client_review','m2_client_review_submitted');
end $function$;

create function projectceo_product_api.review_m2_client_submission(
  project_id uuid, package_id uuid, submission_id text, revision_id text,
  expected_revision_id text, chosen_variant_id text, decision text, reason text,
  expected_state_revision bigint, idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
#variable_conflict use_variable
declare v_context record; v_role text; v_submission record; v_variant jsonb; v_payload jsonb;
  v_submitted_by_actor_user_id uuid; v_current_review record; v_commit_payload jsonb;
  v_review_result jsonb; v_approval_submitted_at timestamptz;
  v_approval_reviewed_at timestamptz; v_approval_review_reason text;
begin
  if auth.uid() is null then perform projectceo_product._raise('P1101','unauthenticated','{}'::jsonb); end if;
  perform projectceo_product._assert_text(submission_id,'submissionId',160);
  perform projectceo_product._assert_text(revision_id,'revisionId',160);
  perform projectceo_product._assert_text(reason,'reason',4000);
  if decision not in ('approved','rejected','change_requested')
     or (decision='approved' and nullif(btrim(chosen_variant_id),'') is null) then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"CLIENT_REVIEW_INVALID"}'::jsonb);
  end if;
  select * into v_context from projectceo_foundation._authorize_package_human(project_id, package_id, 'review_selection');
  select membership.role into v_role from projectceo_foundation.package_memberships membership
   where membership.organization_id=v_context.organization_id and membership.project_id=project_id
     and membership.package_id=package_id and membership.user_id=v_context.actor_user_id and membership.status='active';
  if v_role <> 'client_approver' then perform projectceo_product._raise('P1103','forbidden','{}'::jsonb); end if;
  select * into v_submission from projectceo_product.m2_workspace_revisions revision
   where revision.organization_id=v_context.organization_id and revision.project_id=project_id
     and revision.package_id=package_id and revision.entity_kind='m2_client_submission'
     and revision.entity_id=submission_id order by revision.revision_no desc limit 1 for update;
  if v_submission is null then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"SUBMISSION_REQUIRED"}'::jsonb);
  end if;
  if v_submission.revision_id is distinct from expected_revision_id then
    perform projectceo_product._raise('P1107','stale_state',jsonb_build_object('currentRevisionId',v_submission.revision_id));
  end if;
  v_submitted_by_actor_user_id := (v_submission.payload->>'submittedByActorUserId')::uuid;
  if (v_submission.payload->>'assignedClientUserId')::uuid is distinct from v_context.actor_user_id
     or not (v_submitted_by_actor_user_id <> v_context.actor_user_id) then
    perform projectceo_product._raise('P1103','forbidden','{"reason":"REVIEWER_IDENTITY_INVALID"}'::jsonb);
  end if;
  select variant into v_variant from jsonb_array_elements(v_submission.payload->'variants') variant
   where variant->>'variantId'=chosen_variant_id;
  if v_variant is null then perform projectceo_product._raise('P1111','validation_failed','{"reason":"VARIANT_NOT_FOUND"}'::jsonb); end if;
  if decision='approved' and (jsonb_array_length(v_variant#>'{budget,staleSelectionRevisionIds}')>0
    or jsonb_array_length(v_variant#>'{budget,missingPriceSelectionRevisionIds}')>0) then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"BUDGET_NOT_CLEAN"}'::jsonb);
  end if;
  select * into v_current_review from projectceo_product.m2_workspace_revisions revision
   where revision.organization_id=v_context.organization_id and revision.project_id=project_id
     and revision.package_id=package_id and revision.entity_kind='m2_client_review'
     and revision.entity_id=submission_id order by revision.revision_no desc limit 1;
  v_payload := jsonb_build_object('submissionId',submission_id,'submissionRevisionId',expected_revision_id,
    'chosenVariantId',chosen_variant_id,'decision',decision,'reviewedAt',statement_timestamp());
  if v_current_review is not null and v_current_review.revision_id is distinct from revision_id then
    perform projectceo_product._raise('P1107','stale_state',jsonb_build_object('currentRevisionId',v_current_review.revision_id));
  end if;
  if v_current_review is null and decision='approved' then
    select event.occurred_at into v_approval_submitted_at
    from projectceo_product.approval_package_events event
    where event.organization_id=v_context.organization_id and event.project_id=project_id
      and event.approval_package_id=v_submission.payload->>'approvalPackageId'
      and event.sequence_no=2 and event.to_status='submitted';
    select event.occurred_at,event.reason into v_approval_reviewed_at,v_approval_review_reason
    from projectceo_product.approval_package_events event
    where event.organization_id=v_context.organization_id and event.project_id=project_id
      and event.approval_package_id=v_submission.payload->>'approvalPackageId'
      and event.to_status='approved' and event.self_approved=false
      and event.actor_user_id=v_context.actor_user_id
    order by event.sequence_no desc limit 1;
    if v_approval_submitted_at is null or v_approval_reviewed_at is null then
      perform projectceo_product._raise('P1111','validation_failed','{"reason":"APPROVAL_PACKAGE_REQUIRED"}'::jsonb);
    end if;
    v_commit_payload := jsonb_build_object(
      'approvalPackageId',v_submission.payload->>'approvalPackageId',
      'roomId',v_submission.payload->>'roomId',
      'designIntentRevisionId',v_submission.payload->>'designIntentRevisionId',
      'chosenVariant',v_variant - array['selectionRevisionIds','budget','layoutRevisionId'],
      'approvedSelectionRevisionIds',v_variant->'selectionRevisionIds',
      'budget',jsonb_build_object('asOf',v_submission.payload->>'budgetAsOf',
        'staleAfterDays',(v_submission.payload->>'staleAfterDays')::integer,
        'amountRub',v_variant#>'{budget,amountRub}',
        'staleSelectionRevisionIds',v_variant#>'{budget,staleSelectionRevisionIds}',
        'missingPriceSelectionRevisionIds',v_variant#>'{budget,missingPriceSelectionRevisionIds}'),
      'submittedAt',v_approval_submitted_at,'reviewedAt',v_approval_reviewed_at,
      'submissionReason',v_submission.payload->>'submissionReason',
      'reviewReason',v_approval_review_reason);
  end if;
  v_review_result := projectceo_product._append_m2_cycle6_revision(v_context,project_id,package_id,
    'm2_client_review',submission_id,revision_id,null,decision,v_payload,reason,
    expected_state_revision,idempotency_key,'review_m2_client_submission','m2_client_submission_reviewed');
  if v_current_review is null and decision='approved' then
    -- Canonical API emits append_m2_approved_commit_revision and
    -- m2_approved_commit_revision_appended in this same transaction.
    perform projectceo_product_api.append_m2_workspace_revision(project_id,package_id,
      'approved_commit','approved-'||submission_id,revision_id,null,'approved',v_commit_payload,
      reason,expected_state_revision+1,idempotency_key||':approved-commit');
  end if;
  return v_review_result;
end $function$;

create function projectceo_product_api.publish_m2_m3_handoff(
  project_id uuid, package_id uuid, handoff_id text, revision_id text,
  expected_revision_id text, approved_commit_id text, approved_commit_revision_id text,
  reason text, expected_state_revision bigint, idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
#variable_conflict use_variable
declare v_context record; v_role text; v_commit record; v_layout record; v_payload jsonb;
begin
  if auth.uid() is null then perform projectceo_product._raise('P1101','unauthenticated','{}'::jsonb); end if;
  select * into v_context from projectceo_foundation._authorize_package_human(project_id, package_id, 'publish_baseline');
  select membership.role into v_role from projectceo_foundation.project_memberships membership
   where membership.organization_id=v_context.organization_id and membership.project_id=project_id
     and membership.user_id=v_context.actor_user_id and membership.status='active';
  if v_role not in ('owner_lead','architect') then perform projectceo_product._raise('P1103','forbidden','{}'::jsonb); end if;
  select * into v_commit from projectceo_product.m2_workspace_revisions revision
   where revision.organization_id=v_context.organization_id and revision.project_id=project_id
     and revision.package_id=package_id and revision.entity_kind='approved_commit'
     and revision.entity_id=approved_commit_id and revision.revision_id=approved_commit_revision_id
     and revision.status='approved';
  if v_commit is null then perform projectceo_product._raise('P1111','validation_failed','{"reason":"APPROVED_COMMIT_REQUIRED"}'::jsonb); end if;
  if v_commit.payload->>'clientSubmissionId' is null
     or v_commit.payload->>'clientReviewRevisionId' is null
     or not exists (select 1 from projectceo_product.m2_workspace_revisions review
       where review.organization_id=v_context.organization_id and review.project_id=project_id
         and review.package_id=package_id and review.entity_kind='m2_client_review'
         and review.entity_id=v_commit.payload->>'clientSubmissionId'
         and review.revision_id=v_commit.payload->>'clientReviewRevisionId'
         and review.status='approved'
         and review.payload->>'chosenVariantId'=v_commit.payload#>>'{chosenVariant,variantId}') then
    perform projectceo_product._raise('P1111','validation_failed','{"reason":"APPROVED_CLIENT_REVIEW_REQUIRED"}'::jsonb);
  end if;
  select * into v_layout from projectceo_product.m2_workspace_revisions revision
   where revision.organization_id=v_context.organization_id and revision.project_id=project_id
     and revision.package_id=package_id and revision.entity_kind='layout_version' and revision.status='published'
     and revision.entity_id=v_commit.payload#>>'{chosenVariant,layoutDocumentId}'
     and revision.revision_id=v_commit.payload#>>'{chosenVariant,layoutRevisionId}'
     and revision.payload->>'versionId'=v_commit.payload#>>'{chosenVariant,layoutVersionId}'
     and revision.payload->>'semanticHash'=v_commit.payload#>>'{chosenVariant,semanticHash}'
   order by revision.revision_no desc limit 1;
  if v_layout is null then perform projectceo_product._raise('P1111','validation_failed','{"reason":"APPROVED_LAYOUT_REQUIRED"}'::jsonb); end if;
  v_payload := jsonb_build_object('approvedCommitId',approved_commit_id,
    'approvedCommitRevisionId',approved_commit_revision_id,'roomId',v_commit.payload->>'roomId',
    'designIntentRevisionId',v_commit.payload->>'designIntentRevisionId','chosenVariant',v_commit.payload->'chosenVariant',
    'layoutRevisionId',v_layout.revision_id,'selectionRevisionIds',v_commit.payload->'approvedSelectionRevisionIds',
    'budget',v_commit.payload->'budget','schemaVersion','archidom.m2-to-m3-handoff/0.1',
    'publishedAt',statement_timestamp());
  return projectceo_product._append_m2_cycle6_revision(v_context,project_id,package_id,
    'm2_m3_handoff',handoff_id,revision_id,expected_revision_id,'published',v_payload,reason,
    expected_state_revision,idempotency_key,'publish_m2_m3_handoff','m2_m3_handoff_published');
end $function$;

alter function projectceo_product_api.submit_m2_client_review(uuid,uuid,text,text,text,text,text,text,jsonb,text,integer,text,bigint,text) owner to pi_table_owner;
alter function projectceo_product_api.review_m2_client_submission(uuid,uuid,text,text,text,text,text,text,bigint,text) owner to pi_table_owner;
alter function projectceo_product_api.publish_m2_m3_handoff(uuid,uuid,text,text,text,text,text,text,bigint,text) owner to pi_table_owner;
revoke all on function projectceo_product_api.submit_m2_client_review(uuid,uuid,text,text,text,text,text,text,jsonb,text,integer,text,bigint,text) from public,anon,service_role;
revoke all on function projectceo_product_api.review_m2_client_submission(uuid,uuid,text,text,text,text,text,text,bigint,text) from public,anon,service_role;
revoke all on function projectceo_product_api.publish_m2_m3_handoff(uuid,uuid,text,text,text,text,text,text,bigint,text) from public,anon,service_role;
grant execute on function projectceo_product_api.submit_m2_client_review(uuid,uuid,text,text,text,text,text,text,jsonb,text,integer,text,bigint,text) to authenticated;
grant execute on function projectceo_product_api.review_m2_client_submission(uuid,uuid,text,text,text,text,text,text,bigint,text) to authenticated;
grant execute on function projectceo_product_api.publish_m2_m3_handoff(uuid,uuid,text,text,text,text,text,text,bigint,text) to authenticated;

create function projectceo_read_api.get_project_workspace_read_v6(project_id uuid, package_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_variable
declare v_base jsonb; v_org uuid; v_actor uuid; v_role text; v_submissions jsonb := '[]'::jsonb;
  v_reviews jsonb := '[]'::jsonb; v_handoffs jsonb := '[]'::jsonb;
begin
  begin
    v_base := projectceo_read_api.get_project_workspace_read_v5(project_id, package_id);
  exception when sqlstate 'P1103' or sqlstate 'P1104' then
    return jsonb_build_object('contractVersion','project-ceo-authenticated-read/0.1',
      'requestId','db:'||extensions.gen_random_uuid()::text,'data',null,
      'error',jsonb_build_object('code','forbidden','messageKey','projectceo.read.forbidden'),
      'scope',null,'stateRevision',null);
  end;
  if v_base->'error' is not null and v_base->'error'<>'null'::jsonb then return v_base; end if;
  v_org := (v_base#>>'{scope,organizationId}')::uuid; v_actor := (v_base#>>'{scope,actorUserId}')::uuid;
  if package_id is not null and not exists (
    select 1 from projectceo_foundation.package_memberships membership
    where membership.organization_id=v_org and membership.project_id=get_project_workspace_read_v6.project_id
      and membership.package_id=get_project_workspace_read_v6.package_id
      and membership.user_id=v_actor and membership.status='active'
  ) then
    return jsonb_build_object('contractVersion',v_base->>'contractVersion',
      'requestId',v_base->>'requestId','data',null,'error',jsonb_build_object(
        'code','forbidden','messageKey','projectceo.read.forbidden'),
      'scope',null,'stateRevision',null);
  end if;
  select membership.role into v_role from projectceo_foundation.project_memberships membership
   where membership.organization_id=v_org and membership.project_id=get_project_workspace_read_v6.project_id
     and membership.user_id=v_actor and membership.status='active';
  if package_id is not null then
    select membership.role into v_role from projectceo_foundation.package_memberships membership
     where membership.organization_id=v_org and membership.project_id=get_project_workspace_read_v6.project_id
       and membership.package_id=get_project_workspace_read_v6.package_id
       and membership.user_id=v_actor and membership.status='active';
  end if;
  if v_role in ('owner_lead','architect') or (v_role='client_approver' and package_id is not null) then
    select coalesce(jsonb_agg(jsonb_build_object('id',r.entity_id,'packageId',r.package_id,
      'revisionId',r.revision_id,'revisionNo',r.revision_no,'status',r.status,
      'assignedClientUserId',r.payload->>'assignedClientUserId','payload',r.payload-'assignedClientUserId',
      'createdAt',r.created_at) order by r.created_at),'[]'::jsonb) into v_submissions
    from projectceo_product.m2_workspace_revisions r where r.organization_id=v_org and r.project_id=project_id
      and (package_id is null or r.package_id=package_id) and r.entity_kind='m2_client_submission'
      and (v_role<>'client_approver' or (r.payload->>'assignedClientUserId')::uuid=v_actor);
    select coalesce(jsonb_agg(jsonb_build_object('id',r.entity_id,'packageId',r.package_id,
      'revisionId',r.revision_id,'revisionNo',r.revision_no,'status',r.status,
      'submissionId',r.payload->>'submissionId','chosenVariantId',r.payload->>'chosenVariantId',
      'createdAt',r.created_at) order by r.created_at),'[]'::jsonb) into v_reviews
    from projectceo_product.m2_workspace_revisions r where r.organization_id=v_org and r.project_id=project_id
      and (package_id is null or r.package_id=package_id) and r.entity_kind='m2_client_review'
      and (v_role <> 'client_approver' or exists (
        select 1
        from projectceo_product.m2_workspace_revisions submission
        where submission.organization_id = r.organization_id
          and submission.project_id = r.project_id
          and submission.package_id = r.package_id
          and submission.entity_kind = 'm2_client_submission'
          and submission.entity_id = r.payload->>'submissionId'
          and (submission.payload->>'assignedClientUserId')::uuid = v_actor
      ));
  end if;
  if v_role in ('owner_lead','architect') then
    select coalesce(jsonb_agg(jsonb_build_object('id',r.entity_id,'packageId',r.package_id,
      'revisionId',r.revision_id,'revisionNo',r.revision_no,'status',r.status,
      'approvedCommitId',r.payload->>'approvedCommitId','layoutRevisionId',r.payload->>'layoutRevisionId',
      'selectionRevisionIds',r.payload->'selectionRevisionIds','createdAt',r.created_at)
      order by r.created_at),'[]'::jsonb) into v_handoffs
    from projectceo_product.m2_workspace_revisions r where r.organization_id=v_org and r.project_id=project_id
      and (package_id is null or r.package_id=package_id) and r.entity_kind='m2_m3_handoff';
  elsif v_role in ('builder','guest') then
    v_handoffs := '[]'::jsonb; -- builder and guest never receive M3 approved inputs.
  end if;
  v_base := jsonb_set(v_base,'{data,m2ClientReviewSubmissions}',v_submissions,true);
  v_base := jsonb_set(v_base,'{data,m2ClientReviews}',v_reviews,true);
  return jsonb_set(v_base,'{data,m2M3Handoffs}',v_handoffs,true);
end $function$;

alter function projectceo_read_api.get_project_workspace_read_v6(uuid,uuid) owner to pi_table_owner;
revoke all on function projectceo_read_api.get_project_workspace_read_v6(uuid,uuid) from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor;
grant execute on function projectceo_read_api.get_project_workspace_read_v6(uuid,uuid) to authenticated;

commit;
