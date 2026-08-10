-- ProjectCEO RU thin M3: persistence for documentation sheets.
--
-- Additive only. The M3 data model lives in its own private schema, reachable
-- by application code exclusively through fixed security-definer RPCs — the
-- shape M4 already established. Idempotency, the append-only audit ledger and
-- the project state revision are REUSED from projectceo_product: A5 forbids a
-- second revision mechanism, so nothing here re-implements them.
--
-- The single door into M3 is the persisted `m2_m3_handoff` revision published
-- by projectceo_product_api.publish_m2_m3_handoff. Sheet provenance is derived
-- from that row on the server; the caller cannot assign it. This mirrors the
-- domain rule in lib/project-intelligence/modules/documentation/workflow.ts.

begin;

set local check_function_bodies = on;

create schema projectceo_m3 authorization pi_table_owner;
create schema projectceo_m3_api authorization pi_table_owner;

revoke all on schema projectceo_m3
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on schema projectceo_m3_api
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

alter default privileges for role pi_table_owner
  in schema projectceo_m3
  revoke all on tables from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema projectceo_m3
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter default privileges for role pi_table_owner
  in schema projectceo_m3_api
  revoke execute on functions from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Two new operations on the shared idempotency ledger and two new audit event
-- types. The full vocabulary is restated because a CHECK constraint cannot be
-- extended in place; every value below already existed except the last two.
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
  'review_m2_client_submission', 'publish_m2_m3_handoff',
  'register_m3_documentation_sheet', 'attach_m3_documentation_sheet_specifications'
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
  'm2_client_submission_reviewed', 'm2_m3_handoff_published',
  'm3_documentation_sheet_registered', 'm3_documentation_sheet_specifications_attached'
));

-- Sheet revisions. Append-only: a new revision supersedes the previous one and
-- the previous row is never rewritten, exactly as the domain function
-- attachSheetSpecifications behaves in memory.
--
-- No status vocabulary is introduced: P0 sheets have no lifecycle, and the
-- module deliberately does not invent one (the mandatory sheet set is not
-- ratified anywhere).
create table projectceo_m3.documentation_sheet_revisions (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  sheet_id text not null check (
    char_length(btrim(sheet_id)) between 1 and 160
    and sheet_id = btrim(sheet_id)
  ),
  revision_id text not null check (
    char_length(btrim(revision_id)) between 1 and 160
    and revision_id = btrim(revision_id)
  ),
  revision_no bigint not null check (revision_no between 1 and 9007199254740991),
  supersedes_revision_id text,
  room_id text not null check (
    char_length(btrim(room_id)) between 1 and 160
    and room_id = btrim(room_id)
  ),
  sheet_number text not null check (
    char_length(btrim(sheet_number)) between 1 and 64
    and sheet_number = btrim(sheet_number)
  ),
  title text not null check (
    char_length(btrim(title)) between 1 and 400
    and title = btrim(title)
  ),
  handoff_id text not null,
  handoff_revision_id text not null,
  handoff_contract_version text not null,
  approved_m2_commit_revision_id text not null,
  design_intent_revision_id text not null,
  layout_document_id text not null,
  layout_version_id text not null,
  layout_revision_id text not null,
  -- The layout signature is the load-bearing property of a sheet: without it
  -- the sheet proves nothing. Canonical form only.
  semantic_hash text not null check (semantic_hash ~ '^sha256:[0-9a-f]{64}$'),
  -- An empty set is legal: the domain registers a sheet before its choices are
  -- attached, and the completeness review is what names the gap. The database
  -- is not stricter than registerDocumentationSheet.
  specification_revision_ids text[] not null check (
    cardinality(specification_revision_ids) between 0 and 2000
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  reason text not null check (
    char_length(btrim(reason)) between 3 and 4000
    and reason = btrim(reason)
  ),
  reason_digest bytea not null check (octet_length(reason_digest) = 32),
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, sheet_id, revision_id),
  constraint documentation_sheet_revisions_package_fkey foreign key
    (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (organization_id, project_id, id)
    on delete restrict,
  constraint documentation_sheet_revisions_project_fkey foreign key
    (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id)
    on delete restrict,
  constraint documentation_sheet_revisions_supersedes_fkey foreign key
    (organization_id, project_id, sheet_id, supersedes_revision_id)
    references projectceo_m3.documentation_sheet_revisions
      (organization_id, project_id, sheet_id, revision_id)
    on delete restrict,
  constraint documentation_sheet_revisions_version_key unique
    (organization_id, project_id, sheet_id, revision_no),
  constraint documentation_sheet_revisions_lineage_shape_check check (
    (revision_no = 1 and supersedes_revision_id is null)
    or (revision_no > 1 and supersedes_revision_id is not null)
  )
);

create index documentation_sheet_revisions_latest_idx
  on projectceo_m3.documentation_sheet_revisions
    (organization_id, project_id, sheet_id, revision_no desc);

create index documentation_sheet_revisions_package_idx
  on projectceo_m3.documentation_sheet_revisions
    (organization_id, project_id, package_id, approved_m2_commit_revision_id);

-- A sheet number must stay an unambiguous reference inside its package. The
-- completeness review reports duplicates it finds; this registry makes them
-- impossible to create in the first place — the revision table alone cannot
-- express the rule, because one sheet legitimately has many revisions.
create table projectceo_m3.documentation_sheet_numbers (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  sheet_number text not null,
  sheet_id text not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, sheet_number),
  constraint documentation_sheet_numbers_sheet_key unique
    (organization_id, project_id, package_id, sheet_id),
  constraint documentation_sheet_numbers_package_fkey foreign key
    (organization_id, project_id, package_id)
    references projectceo_foundation.project_packages (organization_id, project_id, id)
    on delete restrict
);

create trigger documentation_sheet_revisions_append_only
before update or delete on projectceo_m3.documentation_sheet_revisions
for each row execute function projectceo_product.reject_append_only_mutation();

create trigger documentation_sheet_numbers_append_only
before update or delete on projectceo_m3.documentation_sheet_numbers
for each row execute function projectceo_product.reject_append_only_mutation();

alter table projectceo_m3.documentation_sheet_revisions owner to pi_table_owner;
alter table projectceo_m3.documentation_sheet_revisions enable row level security;
alter table projectceo_m3.documentation_sheet_revisions force row level security;
revoke all on table projectceo_m3.documentation_sheet_revisions
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy documentation_sheet_revisions_internal_owner
on projectceo_m3.documentation_sheet_revisions
for all to pi_table_owner using (true) with check (true);

alter table projectceo_m3.documentation_sheet_numbers owner to pi_table_owner;
alter table projectceo_m3.documentation_sheet_numbers enable row level security;
alter table projectceo_m3.documentation_sheet_numbers force row level security;
revoke all on table projectceo_m3.documentation_sheet_numbers
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
create policy documentation_sheet_numbers_internal_owner
on projectceo_m3.documentation_sheet_numbers
for all to pi_table_owner using (true) with check (true);

-- Shared validation for both write paths: the requested selection revisions
-- must be non-blank, listed once, and inside the set the client approved in M2.
--
-- An empty request is accepted, mirroring the domain: a sheet may exist before
-- its choices are attached, and naming that gap is the completeness review's
-- job, not a storage constraint.
create function projectceo_m3._assert_approved_specifications(
  p_requested text[],
  p_approved text[]
)
returns void
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_total bigint;
  v_distinct bigint;
begin
  if p_requested is null or cardinality(p_requested) = 0 then
    return;
  end if;
  select count(*), count(distinct value) into v_total, v_distinct
  from unnest(p_requested) value;
  if v_total <> v_distinct then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"DUPLICATE_SPECIFICATION"}'::jsonb
    );
  end if;
  if exists (
    select 1 from unnest(p_requested) value
    where btrim(value) = '' or value <> btrim(value) or char_length(value) > 160
  ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"SPECIFICATION_REVISION_INVALID"}'::jsonb
    );
  end if;
  -- A sheet may not reference a choice outside the approved set: that would be
  -- a break in provability between what the client approved and what is issued.
  if exists (
    select 1 from unnest(p_requested) value
    where not (value = any (coalesce(p_approved, array[]::text[])))
  ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"SPECIFICATION_NOT_APPROVED"}'::jsonb
    );
  end if;
end
$function$;

alter function projectceo_m3._assert_approved_specifications(text[], text[])
  owner to pi_table_owner;
revoke all on function projectceo_m3._assert_approved_specifications(text[], text[])
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

-- Reads the published M2 handoff that a sheet is built from. Everything a
-- sheet claims about its origin comes from this row and nowhere else.
create function projectceo_m3._require_published_handoff(
  p_organization_id uuid,
  p_project_id uuid,
  p_package_id uuid,
  p_handoff_id text,
  p_handoff_revision_id text
)
returns projectceo_product.m2_workspace_revisions
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_handoff projectceo_product.m2_workspace_revisions;
begin
  select * into v_handoff
  from projectceo_product.m2_workspace_revisions revision
  where revision.organization_id = p_organization_id
    and revision.project_id = p_project_id
    and revision.package_id = p_package_id
    and revision.entity_kind = 'm2_m3_handoff'
    and revision.entity_id = p_handoff_id
    and revision.revision_id = p_handoff_revision_id
    and revision.status = 'published';
  if v_handoff is null then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"M2_HANDOFF_REQUIRED"}'::jsonb
    );
  end if;
  if coalesce(v_handoff.payload->>'roomId', '') = ''
     or coalesce(v_handoff.payload->>'approvedCommitRevisionId', '') = ''
     or coalesce(v_handoff.payload->>'designIntentRevisionId', '') = ''
     or coalesce(v_handoff.payload->>'schemaVersion', '') = ''
     or coalesce(v_handoff.payload->>'layoutRevisionId', '') = ''
     or coalesce(v_handoff.payload#>>'{chosenVariant,layoutDocumentId}', '') = ''
     or coalesce(v_handoff.payload#>>'{chosenVariant,layoutVersionId}', '') = '' then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"M2_HANDOFF_INCOMPLETE"}'::jsonb
    );
  end if;
  if coalesce(v_handoff.payload#>>'{chosenVariant,semanticHash}', '') !~ '^sha256:[0-9a-f]{64}$' then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"LAYOUT_SIGNATURE_INVALID"}'::jsonb
    );
  end if;
  return v_handoff;
end
$function$;

alter function projectceo_m3._require_published_handoff(uuid, uuid, uuid, text, text)
  owner to pi_table_owner;
revoke all on function projectceo_m3._require_published_handoff(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

create function projectceo_m3_api.register_documentation_sheet(
  project_id uuid,
  package_id uuid,
  handoff_id text,
  handoff_revision_id text,
  sheet_id text,
  sheet_number text,
  title text,
  revision_id text,
  specification_revision_ids text[],
  reason text,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_role text;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_handoff projectceo_product.m2_workspace_revisions;
  v_approved text[];
  v_room_id text;
  v_semantic_hash text;
  v_payload jsonb;
  v_existing_number text;
begin
  if auth.uid() is null then
    perform projectceo_product._raise('P1101', 'unauthenticated', '{}'::jsonb);
  end if;
  perform projectceo_product._assert_text(handoff_id, 'handoffId', 160);
  perform projectceo_product._assert_text(handoff_revision_id, 'handoffRevisionId', 160);
  perform projectceo_product._assert_text(sheet_id, 'sheetId', 160);
  perform projectceo_product._assert_text(sheet_number, 'sheetNumber', 64);
  perform projectceo_product._assert_text(title, 'title', 400);
  perform projectceo_product._assert_text(revision_id, 'revisionId', 160);
  perform projectceo_product._assert_text(reason, 'reason', 4000);
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  -- The documentation package is prepared by the studio side, never by the
  -- client approver — the same authority that publishes the M2 handoff.
  select * into v_context
  from projectceo_foundation._authorize_package_human(project_id, package_id, 'prepare_client_handoff');
  select membership.role into v_role
  from projectceo_foundation.project_memberships membership
  where membership.organization_id = v_context.organization_id
    and membership.project_id = project_id
    and membership.user_id = v_context.actor_user_id
    and membership.status = 'active';
  if v_role not in ('owner_lead', 'architect') then
    perform projectceo_product._raise('P1103', 'forbidden', '{}'::jsonb);
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'projectId', project_id, 'packageId', package_id, 'handoffId', handoff_id,
    'handoffRevisionId', handoff_revision_id, 'sheetId', sheet_id,
    'sheetNumber', sheet_number, 'title', title, 'revisionId', revision_id,
    'specificationRevisionIds', to_jsonb(specification_revision_ids),
    'reason', reason, 'expectedStateRevision', expected_state_revision
  ));

  select workflow.state_revision into v_state_revision
  from project_intelligence.project_workflows workflow
  where workflow.organization_id = v_context.organization_id
    and workflow.project_id = project_id
  for update;

  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id, project_id, 'register_m3_documentation_sheet',
    v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107', 'stale_state', jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  if exists (
    select 1 from projectceo_m3.documentation_sheet_revisions sheet
    where sheet.organization_id = v_context.organization_id
      and sheet.project_id = project_id
      and sheet.sheet_id = sheet_id
  ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"SHEET_ALREADY_REGISTERED"}'::jsonb
    );
  end if;

  v_handoff := projectceo_m3._require_published_handoff(
    v_context.organization_id, project_id, package_id, handoff_id, handoff_revision_id
  );
  select array_agg(value) into v_approved
  from jsonb_array_elements_text(v_handoff.payload->'selectionRevisionIds') value;
  perform projectceo_m3._assert_approved_specifications(specification_revision_ids, v_approved);
  specification_revision_ids := coalesce(specification_revision_ids, array[]::text[]);

  -- The room is taken from the handoff, never from the caller: a sheet whose
  -- room could drift from the approved decision would prove nothing.
  v_room_id := v_handoff.payload->>'roomId';
  v_semantic_hash := v_handoff.payload#>>'{chosenVariant,semanticHash}';

  select number.sheet_number into v_existing_number
  from projectceo_m3.documentation_sheet_numbers number
  where number.organization_id = v_context.organization_id
    and number.project_id = project_id
    and number.package_id = package_id
    and number.sheet_number = sheet_number;
  if v_existing_number is not null then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"DUPLICATE_SHEET_NUMBER"}'::jsonb
    );
  end if;

  v_payload := jsonb_build_object(
    'sheetId', sheet_id,
    'sheetNumber', sheet_number,
    'title', title,
    'roomId', v_room_id,
    'origin', jsonb_build_object(
      'handoffContractVersion', v_handoff.payload->>'schemaVersion',
      'approvedM2CommitRevisionId', v_handoff.payload->>'approvedCommitRevisionId',
      'designIntentRevisionId', v_handoff.payload->>'designIntentRevisionId',
      'layoutDocumentId', v_handoff.payload#>>'{chosenVariant,layoutDocumentId}',
      'layoutVersionId', v_handoff.payload#>>'{chosenVariant,layoutVersionId}',
      'layoutRevisionId', v_handoff.payload->>'layoutRevisionId',
      'semanticHash', v_semantic_hash
    ),
    'specificationRevisionIds', to_jsonb(specification_revision_ids),
    'registeredAt', statement_timestamp()
  );

  insert into projectceo_m3.documentation_sheet_numbers (
    organization_id, project_id, package_id, sheet_number, sheet_id
  ) values (
    v_context.organization_id, project_id, package_id, sheet_number, sheet_id
  );

  insert into projectceo_m3.documentation_sheet_revisions (
    organization_id, project_id, package_id, sheet_id, revision_id, revision_no,
    supersedes_revision_id, room_id, sheet_number, title, handoff_id, handoff_revision_id,
    handoff_contract_version, approved_m2_commit_revision_id, design_intent_revision_id,
    layout_document_id, layout_version_id, layout_revision_id, semantic_hash,
    specification_revision_ids, payload, reason, reason_digest, created_by_user_id
  ) values (
    v_context.organization_id, project_id, package_id, sheet_id, revision_id, 1,
    null, v_room_id, sheet_number, title, handoff_id, handoff_revision_id,
    v_handoff.payload->>'schemaVersion',
    v_handoff.payload->>'approvedCommitRevisionId',
    v_handoff.payload->>'designIntentRevisionId',
    v_handoff.payload#>>'{chosenVariant,layoutDocumentId}',
    v_handoff.payload#>>'{chosenVariant,layoutVersionId}',
    v_handoff.payload->>'layoutRevisionId',
    v_semantic_hash,
    specification_revision_ids, v_payload, reason,
    project_intelligence._sha256_text(reason), v_context.actor_user_id
  );

  return projectceo_product._complete_command(
    v_context.organization_id, project_id, 'register_m3_documentation_sheet',
    v_key_digest, v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    jsonb_build_object(
      'sheetId', sheet_id, 'revisionId', revision_id, 'revisionNo', 1,
      'packageId', package_id, 'roomId', v_room_id,
      'specificationRevisionIds', to_jsonb(specification_revision_ids)
    ),
    'm3_documentation_sheet_registered',
    jsonb_build_object('sheet_id', sheet_id, 'revision_no', 1, 'sheet_number', sheet_number),
    v_state_revision
  );
end
$function$;

create function projectceo_m3_api.attach_documentation_sheet_specifications(
  project_id uuid,
  package_id uuid,
  sheet_id text,
  revision_id text,
  expected_revision_id text,
  specification_revision_ids text[],
  reason text,
  expected_state_revision bigint,
  idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_role text;
  v_state_revision bigint;
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_current projectceo_m3.documentation_sheet_revisions;
  v_handoff projectceo_product.m2_workspace_revisions;
  v_approved text[];
  v_merged text[];
  v_payload jsonb;
begin
  if auth.uid() is null then
    perform projectceo_product._raise('P1101', 'unauthenticated', '{}'::jsonb);
  end if;
  perform projectceo_product._assert_text(sheet_id, 'sheetId', 160);
  perform projectceo_product._assert_text(revision_id, 'revisionId', 160);
  -- Привязка всегда продолжает существующую ревизию: NULL или пустое значение
  -- здесь — сломанный запрос (validation_failed), а не устаревшее состояние,
  -- которое клиенту предложили бы бесполезно ретраить.
  perform projectceo_product._assert_text(expected_revision_id, 'expectedRevisionId', 160);
  perform projectceo_product._assert_text(reason, 'reason', 4000);
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);

  select * into v_context
  from projectceo_foundation._authorize_package_human(project_id, package_id, 'prepare_client_handoff');
  select membership.role into v_role
  from projectceo_foundation.project_memberships membership
  where membership.organization_id = v_context.organization_id
    and membership.project_id = project_id
    and membership.user_id = v_context.actor_user_id
    and membership.status = 'active';
  if v_role not in ('owner_lead', 'architect') then
    perform projectceo_product._raise('P1103', 'forbidden', '{}'::jsonb);
  end if;

  v_key_digest := project_intelligence._sha256_text(btrim(idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'projectId', project_id, 'packageId', package_id, 'sheetId', sheet_id,
    'revisionId', revision_id, 'expectedRevisionId', expected_revision_id,
    'specificationRevisionIds', to_jsonb(specification_revision_ids),
    'reason', reason, 'expectedStateRevision', expected_state_revision
  ));

  select workflow.state_revision into v_state_revision
  from project_intelligence.project_workflows workflow
  where workflow.organization_id = v_context.organization_id
    and workflow.project_id = project_id
  for update;

  v_replay := projectceo_product._replay_or_null(
    v_context.organization_id, project_id, 'attach_m3_documentation_sheet_specifications',
    v_key_digest, v_request_digest
  );
  if v_replay is not null then return v_replay; end if;

  if v_state_revision <> expected_state_revision then
    perform projectceo_product._raise(
      'P1107', 'stale_state', jsonb_build_object('currentStateRevision', v_state_revision)
    );
  end if;

  select * into v_current
  from projectceo_m3.documentation_sheet_revisions sheet
  where sheet.organization_id = v_context.organization_id
    and sheet.project_id = project_id
    and sheet.sheet_id = sheet_id
  order by sheet.revision_no desc
  limit 1
  for update;
  if v_current is null then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"SHEET_REQUIRED"}'::jsonb
    );
  end if;
  if v_current.package_id is distinct from package_id
     or v_current.revision_id is distinct from expected_revision_id then
    perform projectceo_product._raise(
      'P1107', 'stale_state', jsonb_build_object('currentRevisionId', v_current.revision_id)
    );
  end if;

  -- Provenance is a property of the sheet, not of the revision: the same
  -- handoff is re-read so a later attachment cannot smuggle in another origin.
  v_handoff := projectceo_m3._require_published_handoff(
    v_context.organization_id, project_id, package_id,
    v_current.handoff_id, v_current.handoff_revision_id
  );
  select array_agg(value) into v_approved
  from jsonb_array_elements_text(v_handoff.payload->'selectionRevisionIds') value;
  perform projectceo_m3._assert_approved_specifications(specification_revision_ids, v_approved);

  if exists (
    select 1 from unnest(specification_revision_ids) value
    where value = any (v_current.specification_revision_ids)
  ) then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"reason":"SPECIFICATION_ALREADY_ATTACHED"}'::jsonb
    );
  end if;

  v_merged := v_current.specification_revision_ids
    || coalesce(specification_revision_ids, array[]::text[]);
  v_payload := v_current.payload
    || jsonb_build_object(
      'specificationRevisionIds', to_jsonb(v_merged),
      'attachedAt', statement_timestamp()
    );

  insert into projectceo_m3.documentation_sheet_revisions (
    organization_id, project_id, package_id, sheet_id, revision_id, revision_no,
    supersedes_revision_id, room_id, sheet_number, title, handoff_id, handoff_revision_id,
    handoff_contract_version, approved_m2_commit_revision_id, design_intent_revision_id,
    layout_document_id, layout_version_id, layout_revision_id, semantic_hash,
    specification_revision_ids, payload, reason, reason_digest, created_by_user_id
  ) values (
    v_context.organization_id, project_id, package_id, sheet_id, revision_id,
    v_current.revision_no + 1, v_current.revision_id, v_current.room_id,
    v_current.sheet_number, v_current.title, v_current.handoff_id, v_current.handoff_revision_id,
    v_current.handoff_contract_version, v_current.approved_m2_commit_revision_id,
    v_current.design_intent_revision_id, v_current.layout_document_id,
    v_current.layout_version_id, v_current.layout_revision_id, v_current.semantic_hash,
    v_merged, v_payload, reason,
    project_intelligence._sha256_text(reason), v_context.actor_user_id
  );

  return projectceo_product._complete_command(
    v_context.organization_id, project_id, 'attach_m3_documentation_sheet_specifications',
    v_key_digest, v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id,
    jsonb_build_object(
      'sheetId', sheet_id, 'revisionId', revision_id, 'revisionNo', v_current.revision_no + 1,
      'packageId', package_id, 'specificationRevisionIds', to_jsonb(v_merged)
    ),
    'm3_documentation_sheet_specifications_attached',
    jsonb_build_object(
      'sheet_id', sheet_id, 'revision_no', v_current.revision_no + 1,
      'attached_count', cardinality(coalesce(specification_revision_ids, array[]::text[]))
    ),
    v_state_revision
  );
end
$function$;

alter function projectceo_m3_api.register_documentation_sheet(
  uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text
) owner to pi_table_owner;
alter function projectceo_m3_api.attach_documentation_sheet_specifications(
  uuid, uuid, text, text, text, text[], text, bigint, text
) owner to pi_table_owner;

revoke all on function projectceo_m3_api.register_documentation_sheet(
  uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text
) from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
revoke all on function projectceo_m3_api.attach_documentation_sheet_specifications(
  uuid, uuid, text, text, text, text[], text, bigint, text
) from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;

grant usage on schema projectceo_m3_api to authenticated;

grant execute on function projectceo_m3_api.register_documentation_sheet(
  uuid, uuid, text, text, text, text, text, text, text[], text, bigint, text
) to authenticated;
grant execute on function projectceo_m3_api.attach_documentation_sheet_specifications(
  uuid, uuid, text, text, text, text[], text, bigint, text
) to authenticated;

commit;
