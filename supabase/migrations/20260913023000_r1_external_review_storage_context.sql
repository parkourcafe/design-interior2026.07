-- Private storage/CAS foundation only. No review RPC or readiness predicate is exposed.
begin;
do $r1_external_review_registry$
declare
  v_old_operations text[];
  v_old_events text[];
begin
  select array_agg(match[1] order by match[1]) into v_old_operations
  from pg_catalog.pg_constraint c,
    lateral regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), $re$'([a-z0-9_]+)'$re$, 'g') match
  where c.conname = 'command_records_operation_check'
    and c.conrelid = 'projectceo_product.command_records'::regclass;
  select array_agg(match[1] order by match[1]) into v_old_events
  from pg_catalog.pg_constraint c,
    lateral regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), $re$'([a-z0-9_]+)'$re$, 'g') match
  where c.conname = 'audit_events_event_type_check'
    and c.conrelid = 'projectceo_product.audit_events'::regclass;
  if v_old_operations is null or v_old_events is null then
    raise exception 'R1_EXTERNAL_RELEASE_COMMAND_REGISTRY_MISSING';
  end if;
  alter table projectceo_product.command_records drop constraint command_records_operation_check;
  execute format(
    'alter table projectceo_product.command_records add constraint command_records_operation_check check (operation = any (array[%s]))',
    (select string_agg(quote_literal(value), ', ' order by value)
     from (select distinct value from unnest(v_old_operations || array[
       'submit_external_review','decide_external_review','withdraw_external_review'
     ]) value) registry_values)
  );
  alter table projectceo_product.audit_events drop constraint audit_events_event_type_check;
  execute format(
    'alter table projectceo_product.audit_events add constraint audit_events_event_type_check check (event_type = any (array[%s]))',
    (select string_agg(quote_literal(value), ', ' order by value)
     from (select distinct value from unnest(v_old_events || array[
       'submit_external_review','decide_external_review','withdraw_external_review'
     ]) value) registry_values)
  );
end
$r1_external_review_registry$;

create table projectceo_foundation.external_review_subject_heads (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 review_thread_id uuid not null default extensions.gen_random_uuid(),
 lifecycle_revision bigint not null default 0 check (lifecycle_revision between 0 and 9007199254740991),
 last_event_sequence bigint not null default 0 check (last_event_sequence between 0 and 9007199254740991),
 current_submission_id uuid,
 primary key (organization_id, project_id, package_id, review_thread_id),
 foreign key (organization_id, project_id, package_id) references projectceo_foundation.project_packages (organization_id, project_id, id)
);
create table projectceo_foundation.external_review_submissions (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 submission_id uuid not null default extensions.gen_random_uuid(), review_thread_id uuid not null,
 purpose text not null check (purpose in ('file_review','native_release_review')),
 external_attachment_submission_id uuid, handoff_id text, handoff_revision_id text,
 submission_revision bigint not null check (submission_revision between 1 and 9007199254740991),
 subject_digest bytea not null check (octet_length(subject_digest)=32),
 snapshot_schema_version text not null, semantic_snapshot jsonb not null,
 assigned_client_user_id uuid not null, submitted_by_user_id uuid not null,
 submitted_at timestamptz not null default statement_timestamp(),
 reason text not null check (reason=btrim(reason) and char_length(reason) between 1 and 2000),
 replaces_submission_id uuid,
 primary key (organization_id, project_id, package_id, submission_id),
 unique (organization_id, project_id, package_id, submission_id, assigned_client_user_id),
 unique (organization_id, project_id, package_id, review_thread_id, submission_id),
 unique (organization_id, project_id, package_id, review_thread_id, submission_revision),
 unique (organization_id, project_id, package_id, submission_id, subject_digest, submission_revision, submitted_by_user_id),
 foreign key (organization_id, project_id, package_id, review_thread_id) references projectceo_foundation.external_review_subject_heads,
 foreign key (organization_id, project_id, package_id, review_thread_id, replaces_submission_id) references projectceo_foundation.external_review_submissions (organization_id, project_id, package_id, review_thread_id, submission_id),
 foreign key (organization_id, project_id, package_id, external_attachment_submission_id) references projectceo_foundation.external_release_attachment_submissions,
 foreign key (organization_id, submitted_by_user_id) references project_intelligence.organization_members (organization_id,user_id),
 foreign key (organization_id, assigned_client_user_id) references project_intelligence.organization_members (organization_id,user_id),
 check (subject_digest=project_intelligence._sha256_jsonb(semantic_snapshot)),
 check (jsonb_typeof(semantic_snapshot)='object'),
 check ((purpose='file_review' and external_attachment_submission_id is null and handoff_id is null and handoff_revision_id is null and snapshot_schema_version='archidom.external-file-review-subject/0.1') or
 (purpose='native_release_review' and external_attachment_submission_id is not null and handoff_id is not null and handoff_revision_id is not null and snapshot_schema_version='archidom.external-review-subject/0.1'))
);
alter table projectceo_foundation.external_review_subject_heads add foreign key
 (organization_id, project_id, package_id, review_thread_id, current_submission_id)
 references projectceo_foundation.external_review_submissions (organization_id, project_id, package_id, review_thread_id, submission_id);
create table projectceo_foundation.external_review_submission_refs (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  submission_id uuid not null,
  ordinal bigint not null check (ordinal between 0 and 9007199254740991),
  ref_kind text not null check (ref_kind in (
    'asset_version','representation_version','documentation_sheet_revision',
    'object_representation_binding','technical_reference_revision','annotation_revision'
  )),
  -- Sheet identities encode two 160-character IDs as a JSON tuple. At six
  -- characters per escape, 2 * 160 * 6 + 8 JSON characters + 29 prefix = 1957.
  ref_identity text not null check (char_length(ref_identity) between 3 and 2048),
  asset_version_id uuid,
  representation_version_id uuid,
  sheet_id text,
  sheet_revision_id text,
  object_representation_binding_id uuid,
  technical_reference_revision_id uuid,
  annotation_revision_id uuid,
  semantic_content jsonb not null check (jsonb_typeof(semantic_content) = 'object'),
  semantic_digest bytea not null check (octet_length(semantic_digest) = 32),
  primary key (organization_id, project_id, package_id, submission_id, ordinal),
  unique (organization_id, project_id, package_id, submission_id, ref_identity),
  foreign key (organization_id, project_id, package_id, submission_id)
    references projectceo_foundation.external_review_submissions
      (organization_id, project_id, package_id, submission_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, asset_version_id)
    references projectceo_foundation.external_asset_versions (organization_id, project_id, package_id, asset_version_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, representation_version_id)
    references projectceo_foundation.external_representation_versions (organization_id, project_id, package_id, representation_version_id) on delete restrict,
  foreign key (organization_id, project_id, sheet_id, sheet_revision_id)
    references projectceo_m3.documentation_sheet_revisions (organization_id, project_id, sheet_id, revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, object_representation_binding_id)
    references projectceo_foundation.object_representation_bindings (organization_id, project_id, package_id, binding_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, technical_reference_revision_id)
    references projectceo_foundation.technical_reference_versions (organization_id, project_id, package_id, technical_reference_revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, annotation_revision_id)
    references projectceo_foundation.external_annotation_revisions (organization_id, project_id, package_id, annotation_revision_id) on delete restrict,
  check (
    (ref_kind = 'asset_version' and asset_version_id is not null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'representation_version' and asset_version_id is null and representation_version_id is not null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'documentation_sheet_revision' and asset_version_id is null and representation_version_id is null and sheet_id is not null and sheet_revision_id is not null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'object_representation_binding' and asset_version_id is null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is not null and technical_reference_revision_id is null and annotation_revision_id is null)
    or (ref_kind = 'technical_reference_revision' and asset_version_id is null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is not null and annotation_revision_id is null)
    or (ref_kind = 'annotation_revision' and asset_version_id is null and representation_version_id is null and sheet_id is null and sheet_revision_id is null and object_representation_binding_id is null and technical_reference_revision_id is null and annotation_revision_id is not null)
  )
);

create table projectceo_foundation.external_review_design_decisions (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 decision_id uuid not null default extensions.gen_random_uuid(), submission_id uuid not null,
 subject_digest bytea not null check (octet_length(subject_digest)=32), submission_revision bigint not null,
 decision text not null check (decision in ('approved','rejected','change_requested')),
 reason text not null check (reason=btrim(reason) and char_length(reason) between 1 and 2000),
 initiated_by_user_id uuid not null, decided_by_user_id uuid not null,
 decided_at timestamptz not null default statement_timestamp(),
 approval_type text not null default 'CLIENT_APPROVED' check (approval_type='CLIENT_APPROVED'),
 self_approved boolean not null check (self_approved=(initiated_by_user_id=decided_by_user_id)),
 authorship_disclosure jsonb not null check ((jsonb_typeof(authorship_disclosure)='object'
   and jsonb_typeof(authorship_disclosure->'independenceStatus')='string'
   and authorship_disclosure->>'independenceStatus' in ('unknown','not_independent','independent')) is true),
 schema_version text not null default 'archidom.external-review-decision/0.1' check (schema_version='archidom.external-review-decision/0.1'),
 semantic_content jsonb not null, semantic_digest bytea not null check (octet_length(semantic_digest)=32 and semantic_digest=project_intelligence._sha256_jsonb(semantic_content)),
 primary key (organization_id, project_id, package_id, decision_id),
 unique (organization_id, project_id, package_id, submission_id),
 unique (organization_id, project_id, package_id, submission_id, decision_id, semantic_digest),
 foreign key (organization_id, project_id, package_id, submission_id, subject_digest, submission_revision, initiated_by_user_id)
 references projectceo_foundation.external_review_submissions (organization_id, project_id, package_id, submission_id, subject_digest, submission_revision, submitted_by_user_id),
 foreign key (organization_id, decided_by_user_id) references project_intelligence.organization_members (organization_id,user_id)
 , foreign key (organization_id, project_id, package_id, submission_id, decided_by_user_id) references projectceo_foundation.external_review_submissions (organization_id, project_id, package_id, submission_id, assigned_client_user_id)
 , check (self_approved=false)
);
create table projectceo_foundation.external_review_technical_decisions (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 decision_id uuid not null default extensions.gen_random_uuid(), submission_id uuid not null,
 subject_digest bytea not null check (octet_length(subject_digest)=32), submission_revision bigint not null,
 decision text not null check (decision in ('approved','rejected','change_requested')),
 reason text not null check (reason=btrim(reason) and char_length(reason) between 1 and 2000),
 initiated_by_user_id uuid not null, decided_by_user_id uuid not null,
 decided_at timestamptz not null default statement_timestamp(),
 approval_type text not null default 'TECHNICALLY_REVIEWED' check (approval_type='TECHNICALLY_REVIEWED'),
 self_approved boolean not null check (self_approved=(initiated_by_user_id=decided_by_user_id)),
 authorship_disclosure jsonb not null check ((jsonb_typeof(authorship_disclosure)='object'
   and jsonb_typeof(authorship_disclosure->'independenceStatus')='string'
   and authorship_disclosure->>'independenceStatus' in ('unknown','not_independent','independent')) is true),
 schema_version text not null default 'archidom.external-review-decision/0.1' check (schema_version='archidom.external-review-decision/0.1'),
 semantic_content jsonb not null, semantic_digest bytea not null check (octet_length(semantic_digest)=32 and semantic_digest=project_intelligence._sha256_jsonb(semantic_content)),
 primary key (organization_id, project_id, package_id, decision_id),
 unique (organization_id, project_id, package_id, submission_id),
 unique (organization_id, project_id, package_id, submission_id, decision_id, semantic_digest),
 foreign key (organization_id, project_id, package_id, submission_id, subject_digest, submission_revision, initiated_by_user_id)
 references projectceo_foundation.external_review_submissions (organization_id, project_id, package_id, submission_id, subject_digest, submission_revision, submitted_by_user_id),
 foreign key (organization_id, decided_by_user_id) references project_intelligence.organization_members (organization_id,user_id)
 
);
create table projectceo_foundation.external_review_events (
 organization_id uuid not null, project_id uuid not null, package_id uuid not null,
 event_id uuid not null default extensions.gen_random_uuid(), review_thread_id uuid not null, submission_id uuid not null,
 lifecycle_revision bigint not null check (lifecycle_revision>0), event_sequence bigint not null check (event_sequence>0),
 event_kind text not null check (event_kind in ('submitted','replaced','withdrawn','design_decided','technical_decided')),
 actor_user_id uuid not null, occurred_at timestamptz not null default statement_timestamp(),
 reason text not null check (reason=btrim(reason) and char_length(reason) between 1 and 2000),
 previous_submission_id uuid, new_submission_id uuid,
 design_decision_id uuid, technical_decision_id uuid, decision_digest bytea,
 primary key (organization_id, project_id, package_id, event_id),
 unique (organization_id, project_id, package_id, review_thread_id, event_sequence),
 unique (organization_id, project_id, package_id, design_decision_id),
 unique (organization_id, project_id, package_id, technical_decision_id),
 foreign key (organization_id, project_id, package_id, review_thread_id, submission_id) references projectceo_foundation.external_review_submissions (organization_id, project_id, package_id, review_thread_id, submission_id),
 foreign key (organization_id, project_id, package_id, review_thread_id, previous_submission_id) references projectceo_foundation.external_review_submissions (organization_id, project_id, package_id, review_thread_id, submission_id),
 foreign key (organization_id, project_id, package_id, review_thread_id, new_submission_id) references projectceo_foundation.external_review_submissions (organization_id, project_id, package_id, review_thread_id, submission_id),
 foreign key (organization_id, project_id, package_id, submission_id, design_decision_id, decision_digest) references projectceo_foundation.external_review_design_decisions (organization_id, project_id, package_id, submission_id, decision_id, semantic_digest),
 foreign key (organization_id, project_id, package_id, submission_id, technical_decision_id, decision_digest) references projectceo_foundation.external_review_technical_decisions (organization_id, project_id, package_id, submission_id, decision_id, semantic_digest),
 foreign key (organization_id, actor_user_id) references project_intelligence.organization_members (organization_id,user_id),
 check ((event_kind='design_decided' and design_decision_id is not null and technical_decision_id is null and decision_digest is not null) or
 (event_kind='technical_decided' and technical_decision_id is not null and design_decision_id is null and decision_digest is not null) or
 (event_kind in ('submitted','replaced','withdrawn') and design_decision_id is null and technical_decision_id is null and decision_digest is null))
);
create function projectceo_foundation._external_review_validate_evidence() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare s projectceo_foundation.external_review_submissions%rowtype; c projectceo_foundation.external_release_attachment_submissions%rowtype; expected jsonb;
begin
 if tg_table_name='external_review_submissions' then
  if new.semantic_snapshot->>'schemaVersion' is distinct from new.snapshot_schema_version
   or new.semantic_snapshot->>'organizationId' is distinct from new.organization_id::text
   or new.semantic_snapshot->>'projectId' is distinct from new.project_id::text
   or new.semantic_snapshot->>'packageId' is distinct from new.package_id::text
   or jsonb_typeof(new.semantic_snapshot->'refs') is distinct from 'array' then raise exception 'REVIEW_SNAPSHOT_SCOPE'; end if;
  if new.purpose='file_review' then
   if new.semantic_snapshot->>'purpose' is distinct from 'file_review' then raise exception 'REVIEW_PURPOSE'; end if;
  else
   select * into c from projectceo_foundation.external_release_attachment_submissions where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and external_attachment_submission_id=new.external_attachment_submission_id;
   if not found or c.semantic_content is distinct from new.semantic_snapshot or c.review_subject_digest is distinct from new.subject_digest or c.handoff_id is distinct from new.handoff_id or c.handoff_revision_id is distinct from new.handoff_revision_id then raise exception 'REVIEW_CANDIDATE_MISMATCH'; end if;
  end if;
 elsif tg_table_name='external_review_submission_refs' then
  select * into strict s from projectceo_foundation.external_review_submissions where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and submission_id=new.submission_id;
  -- Match the candidate resolver convention: normalized evidence stores the
  -- leaf, whereas snapshot.refs stores its complete typed descriptor. Rebuild
  -- that descriptor from every typed selector, so an in-scope FK alone cannot
  -- substitute another version or another ref kind beneath the same hash.
  expected := jsonb_build_object(
   'refKind',new.ref_kind,'refIdentity',new.ref_identity,
   'semanticContent',new.semantic_content,
   'semanticDigest','sha256:'||encode(new.semantic_digest,'hex')
  ) || case new.ref_kind
   when 'asset_version' then jsonb_build_object('assetVersionId',new.asset_version_id)
   when 'representation_version' then jsonb_build_object('representationVersionId',new.representation_version_id)
   when 'documentation_sheet_revision' then jsonb_build_object('sheetId',new.sheet_id,'sheetRevisionId',new.sheet_revision_id)
   when 'object_representation_binding' then jsonb_build_object('objectRepresentationBindingId',new.object_representation_binding_id)
   when 'technical_reference_revision' then jsonb_build_object('technicalReferenceRevisionId',new.technical_reference_revision_id)
   when 'annotation_revision' then jsonb_build_object('annotationRevisionId',new.annotation_revision_id)
   else null end;
  if expected is null
   or new.semantic_digest is distinct from project_intelligence._sha256_jsonb(new.semantic_content)
   or s.semantic_snapshot->'refs'->new.ordinal::integer is distinct from expected then
   raise exception 'REVIEW_REF_MISMATCH';
  end if;
 else
  select * into strict s from projectceo_foundation.external_review_submissions where organization_id=new.organization_id and project_id=new.project_id and package_id=new.package_id and submission_id=new.submission_id;
  expected := jsonb_build_object('schemaVersion',new.schema_version,'purpose',s.purpose,'snapshotSchemaVersion',s.snapshot_schema_version,'organizationId',new.organization_id,'projectId',new.project_id,'packageId',new.package_id,'submissionId',new.submission_id,'submissionRevision',new.submission_revision,'subjectDigest','sha256:'||encode(new.subject_digest,'hex'),'approvalType',new.approval_type,'decision',new.decision,'reason',new.reason,'initiatedByUserId',new.initiated_by_user_id,'decidedByUserId',new.decided_by_user_id,'decidedAt',new.decided_at,'selfApproved',new.self_approved,'authorshipDisclosure',new.authorship_disclosure);
  if new.semantic_content is distinct from expected then raise exception 'REVIEW_DECISION_SEMANTICS'; end if;
 end if;
 return new;
end $fn$;
-- The future RPC must validate its exact role/assignment before consuming replay.
-- This helper handles current scoped capability, revocation serialization and
-- actor-bound idempotency, never readiness or a client global-state precondition.
create function projectceo_foundation._external_review_command_context(
 p_project_id uuid, p_package_id uuid, p_operation text, p_review_type text,
 p_idempotency_key text, p_request_payload jsonb
) returns table (organization_id uuid, actor_user_id uuid, actor_id text,
 state_revision bigint, key_digest bytea, request_digest bytea, replay jsonb)
language plpgsql security definer set search_path='' as $fn$
#variable_conflict use_variable
declare cap text; c record;
begin
 cap := case when p_operation in ('submit_external_review','withdraw_external_review') and p_review_type is null then 'prepare_client_handoff'
 when p_operation='decide_external_review' and p_review_type='design' then 'review_selection'
 when p_operation='decide_external_review' and p_review_type='technical' then 'review_source' end;
 if cap is null then perform projectceo_product._raise('P1111','validation_failed','{}'); end if;
 select distinct a.organization_id,a.actor_user_id,a.actor_id into strict organization_id,actor_user_id,actor_id
 from projectceo_foundation._authorize_package_human(p_project_id,p_package_id,cap) a;
 select w.state_revision into strict state_revision from project_intelligence.project_workflows w
 where w.organization_id=organization_id and w.project_id=p_project_id for update;
 -- Workflow is the first lock, preserving existing audit ordering. Lock every
 -- authorization row actually available to this actor before reauthorization.
 perform 1 from project_intelligence.organizations o where o.id=organization_id for share;
 perform 1 from projectceo_foundation.project_packages pp where pp.organization_id=organization_id and pp.project_id=p_project_id and pp.id=p_package_id for share;
 perform 1 from project_intelligence.organization_members m where m.organization_id=organization_id and m.user_id=actor_user_id for share;
 perform 1 from projectceo_foundation.project_memberships m where m.organization_id=organization_id and m.project_id=p_project_id and m.user_id=actor_user_id for share;
 perform 1 from projectceo_foundation.project_member_capabilities m where m.organization_id=organization_id and m.project_id=p_project_id and m.user_id=actor_user_id and m.capability=cap for share;
 perform 1 from projectceo_foundation.package_memberships m where m.organization_id=organization_id and m.project_id=p_project_id and m.package_id=p_package_id and m.user_id=actor_user_id for share;
 perform 1 from projectceo_foundation.package_member_capabilities m where m.organization_id=organization_id and m.project_id=p_project_id and m.package_id=p_package_id and m.user_id=actor_user_id and m.capability=cap for share;
 perform 1 from projectceo_foundation._authorize_package_human(p_project_id,p_package_id,cap);
 perform projectceo_foundation._assert_idempotency_key(p_idempotency_key);
 key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
 request_digest := project_intelligence._sha256_jsonb(jsonb_build_object('operation',p_operation,'reviewType',p_review_type,'organizationId',organization_id,'projectId',p_project_id,'packageId',p_package_id,'actorUserId',actor_user_id,'payload',p_request_payload));
 select cr.actor_user_id into c from projectceo_product.command_records cr where cr.organization_id=organization_id and cr.project_id=p_project_id and cr.operation=p_operation and cr.key_digest=key_digest;
 if found and c.actor_user_id is distinct from actor_user_id then perform projectceo_product._raise('P1108','idempotency_conflict','{}'); end if;
 replay := projectceo_product._replay_or_null(organization_id,p_project_id,p_operation,key_digest,request_digest);
 return next;
end $fn$;

-- Caller has already locked workflow using the context above. First submission
-- allocates a fresh thread separately; this helper never guesses a latest row.
create function projectceo_foundation._external_review_lock_subject(
 p_organization_id uuid,p_project_id uuid,p_package_id uuid,p_review_thread_id uuid,
 p_submission_id uuid,p_submission_revision bigint,p_subject_digest bytea,p_lifecycle_revision bigint,
 p_allow_withdrawn boolean default false
) returns projectceo_foundation.external_review_subject_heads
language plpgsql security definer set search_path='' as $fn$
declare h projectceo_foundation.external_review_subject_heads%rowtype; s projectceo_foundation.external_review_submissions%rowtype;
begin
 select * into h from projectceo_foundation.external_review_subject_heads where organization_id=p_organization_id and project_id=p_project_id and package_id=p_package_id and review_thread_id=p_review_thread_id for update;
 if not found or h.lifecycle_revision is distinct from p_lifecycle_revision or h.current_submission_id is distinct from p_submission_id then perform projectceo_product._raise('P1107','stale_state','{}'); end if;
 select * into s from projectceo_foundation.external_review_submissions where organization_id=p_organization_id and project_id=p_project_id and package_id=p_package_id and submission_id=p_submission_id and review_thread_id=p_review_thread_id;
 if not found or s.submission_revision is distinct from p_submission_revision or s.subject_digest is distinct from p_subject_digest or (p_allow_withdrawn is not true and exists (
 select 1 from projectceo_foundation.external_review_events e where e.organization_id=p_organization_id and e.project_id=p_project_id and e.package_id=p_package_id and e.review_thread_id=p_review_thread_id and e.submission_id=p_submission_id and e.event_kind='withdrawn')) then perform projectceo_product._raise('P1107','stale_state','{}'); end if;
 return h;
end $fn$;

-- Only a trusted private command body may call this with the context's locked
-- server state. _complete_command remains the single audit/state implementation.
create function projectceo_foundation._external_review_complete_command(
 p_organization_id uuid,p_project_id uuid,p_operation text,p_key_digest bytea,p_request_digest bytea,
 p_actor_user_id uuid,p_result jsonb,p_metadata jsonb,p_server_state_revision bigint
) returns jsonb language sql security definer set search_path='' as $fn$
 select projectceo_product._complete_command(p_organization_id,p_project_id,p_operation,p_key_digest,p_request_digest,'human',p_actor_user_id::text,p_actor_user_id,p_result,p_operation,p_metadata,p_server_state_revision)
$fn$;

create function projectceo_foundation._external_review_head_identity() returns trigger
language plpgsql set search_path='' as $fn$
begin
 if (new.organization_id,new.project_id,new.package_id,new.review_thread_id) is distinct from
 (old.organization_id,old.project_id,old.package_id,old.review_thread_id) then raise exception 'REVIEW_THREAD_SCOPE_IMMUTABLE'; end if;
 if new.lifecycle_revision < old.lifecycle_revision or new.last_event_sequence < old.last_event_sequence then raise exception 'REVIEW_HEAD_REVISION_REGRESSION'; end if;
 return new;
end $fn$;
create trigger external_review_head_identity before update on projectceo_foundation.external_review_subject_heads
 for each row execute function projectceo_foundation._external_review_head_identity();

do $security$
declare t text; f regprocedure;
begin
 foreach t in array array['external_review_subject_heads','external_review_submissions','external_review_submission_refs','external_review_design_decisions','external_review_technical_decisions','external_review_events'] loop
  if t <> 'external_review_subject_heads' then
   execute format('create trigger %I before update or delete on projectceo_foundation.%I for each row execute function projectceo_foundation.reject_append_only_mutation()',t||'_append_only',t);
  end if;
  if t in ('external_review_submissions','external_review_submission_refs','external_review_design_decisions','external_review_technical_decisions') then
   execute format('create trigger %I before insert on projectceo_foundation.%I for each row execute function projectceo_foundation._external_review_validate_evidence()',t||'_validate',t);
  end if;
  execute format('alter table projectceo_foundation.%I owner to pi_table_owner',t);
  execute format('alter table projectceo_foundation.%I enable row level security',t);
  execute format('alter table projectceo_foundation.%I force row level security',t);
  execute format('revoke all on projectceo_foundation.%I from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',t);
  execute format('create policy %I on projectceo_foundation.%I for all to pi_table_owner using (true) with check (true)',t||'_owner_only',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='projectceo_foundation' and p.proname in ('_external_review_validate_evidence','_external_review_command_context','_external_review_lock_subject','_external_review_complete_command','_external_review_head_identity') loop
  execute format('alter function %s owner to pi_table_owner',f);
  execute format('revoke all on function %s from public,anon,authenticated,service_role,pi_human_executor,pi_worker_executor',f);
 end loop;
end $security$;
commit;
