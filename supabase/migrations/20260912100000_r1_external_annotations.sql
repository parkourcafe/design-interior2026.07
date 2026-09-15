begin;
set local search_path = pg_catalog, projectceo_foundation, extensions;

create table projectceo_foundation.external_annotation_revisions (
  organization_id uuid not null,
  project_id uuid not null,
  package_id uuid not null,
  annotation_id uuid not null,
  annotation_revision_id uuid not null default extensions.gen_random_uuid(),
  revision_no bigint not null check (revision_no between 1 and 9007199254740991),
  supersedes_annotation_revision_id uuid,
  representation_version_id uuid not null,
  representation_sha256 bytea not null check (octet_length(representation_sha256) = 32),
  object_revision_id uuid,
  technical_reference_revision_id uuid,
  anchor_kind text not null check (anchor_kind in ('camera', 'point', 'region')),
  camera jsonb check (camera is null or jsonb_typeof(camera) = 'object'),
  point jsonb check (point is null or jsonb_typeof(point) = 'object'),
  region jsonb check (region is null or jsonb_typeof(region) = 'object'),
  body text not null check (char_length(btrim(body)) between 1 and 5000 and body = btrim(body) and body !~ '[[:cntrl:]]'),
  created_by_user_id uuid not null,
  causation_id text not null check (char_length(btrim(causation_id)) between 1 and 160 and causation_id = btrim(causation_id)),
  request_id text not null check (char_length(btrim(request_id)) between 1 and 160 and request_id = btrim(request_id)),
  created_at timestamptz not null default statement_timestamp(),
  primary key (organization_id, project_id, package_id, annotation_revision_id),
  unique (organization_id, project_id, package_id, annotation_id, revision_no),
  unique (organization_id, project_id, package_id, annotation_id, annotation_revision_id),
  foreign key (organization_id, project_id, package_id, representation_version_id)
    references projectceo_foundation.external_representation_versions (organization_id, project_id, package_id, representation_version_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, object_revision_id)
    references projectceo_foundation.project_object_revisions (organization_id, project_id, package_id, object_revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, technical_reference_revision_id)
    references projectceo_foundation.technical_reference_versions (organization_id, project_id, package_id, technical_reference_revision_id) on delete restrict,
  foreign key (organization_id, project_id, package_id, annotation_id, supersedes_annotation_revision_id)
    references projectceo_foundation.external_annotation_revisions (organization_id, project_id, package_id, annotation_id, annotation_revision_id) on delete restrict,
  foreign key (organization_id, created_by_user_id)
    references project_intelligence.organization_members (organization_id, user_id) on delete restrict,
  check ((revision_no = 1 and supersedes_annotation_revision_id is null) or (revision_no > 1 and supersedes_annotation_revision_id is not null)),
  check ((anchor_kind = 'camera' and camera is not null) or (anchor_kind = 'point' and point is not null) or (anchor_kind = 'region' and region is not null))
);

create function projectceo_foundation.assert_r1_annotation_target()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_representation_sha bytea;
  v_technical_representation_id uuid;
  v_technical_preview_sha bytea;
  v_technical_object_revision_id uuid;
begin
  select representation.server_sha256 into v_representation_sha
  from projectceo_foundation.external_representation_versions representation
  where representation.organization_id = new.organization_id
    and representation.project_id = new.project_id
    and representation.package_id = new.package_id
    and representation.representation_version_id = new.representation_version_id;

  if not found or v_representation_sha is distinct from new.representation_sha256 then
    raise exception 'R1_ANNOTATION_REPRESENTATION_MISMATCH';
  end if;

  if new.technical_reference_revision_id is not null then
    select technical.preview_representation_version_id, technical.preview_sha256, technical.object_revision_id
      into v_technical_representation_id, v_technical_preview_sha, v_technical_object_revision_id
    from projectceo_foundation.technical_reference_versions technical
    where technical.organization_id = new.organization_id
      and technical.project_id = new.project_id
      and technical.package_id = new.package_id
      and technical.technical_reference_revision_id = new.technical_reference_revision_id;

    if not found
      or v_technical_representation_id is distinct from new.representation_version_id
      or v_technical_preview_sha is distinct from new.representation_sha256
      or (new.object_revision_id is not null and v_technical_object_revision_id is distinct from new.object_revision_id) then
      raise exception 'R1_ANNOTATION_TECHNICAL_REFERENCE_MISMATCH';
    end if;
  end if;
  return new;
end
$function$;

create trigger external_annotation_revisions_target
before insert on projectceo_foundation.external_annotation_revisions
for each row execute function projectceo_foundation.assert_r1_annotation_target();

alter table projectceo_foundation.external_annotation_revisions owner to pi_table_owner;
alter table projectceo_foundation.external_annotation_revisions enable row level security;
alter table projectceo_foundation.external_annotation_revisions force row level security;
revoke all on table projectceo_foundation.external_annotation_revisions from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
create policy external_annotation_revisions_owner_only on projectceo_foundation.external_annotation_revisions for all to pi_table_owner using (true) with check (true);
create trigger external_annotation_revisions_append_only before update or delete on projectceo_foundation.external_annotation_revisions for each row execute function projectceo_foundation.reject_append_only_mutation();

do $r1_annotation_registry$
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
    raise exception 'R1_ANNOTATION_COMMAND_REGISTRY_MISSING';
  end if;
  alter table projectceo_product.command_records drop constraint command_records_operation_check;
  execute format(
    'alter table projectceo_product.command_records add constraint command_records_operation_check check (operation = any (array[%s]))',
    (select string_agg(quote_literal(value), ', ' order by value) from (select distinct value from unnest(v_old_operations || array['create_external_annotation','revise_external_annotation']) value) registry_values)
  );
  alter table projectceo_product.audit_events drop constraint audit_events_event_type_check;
  execute format(
    'alter table projectceo_product.audit_events add constraint audit_events_event_type_check check (event_type = any (array[%s]))',
    (select string_agg(quote_literal(value), ', ' order by value) from (select distinct value from unnest(v_old_events || array['external_annotation_created','external_annotation_revised']) value) registry_values)
  );
end
$r1_annotation_registry$;

create function projectceo_product_api.create_external_annotation(
  p_project_id uuid,
  p_package_id uuid,
  p_representation_version_id uuid,
  p_object_revision_id uuid,
  p_technical_reference_revision_id uuid,
  p_anchor_kind text,
  p_camera jsonb,
  p_point jsonb,
  p_region jsonb,
  p_body text,
  p_expected_state_revision bigint,
  p_idempotency_key text
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
  v_representation_sha bytea;
  v_annotation_id uuid := extensions.gen_random_uuid();
  v_annotation_revision_id uuid := extensions.gen_random_uuid();
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_context from projectceo_foundation._authorize_package_human(p_project_id, p_package_id, 'review_selection');
  select membership.role into v_role
  from projectceo_foundation.package_memberships membership
  where membership.organization_id = v_context.organization_id
    and membership.project_id = p_project_id
    and membership.package_id = p_package_id
    and membership.user_id = v_context.actor_user_id
    and membership.status = 'active';
  if v_role is distinct from 'client_approver' then
    perform projectceo_product._raise('P1103', 'forbidden', '{}'::jsonb);
  end if;
  if p_anchor_kind not in ('camera', 'point', 'region')
    or p_body is null
    or char_length(btrim(p_body)) not between 1 and 5000
    or p_body <> btrim(p_body)
    or p_body ~ '[[:cntrl:]]'
    or (p_anchor_kind = 'camera' and coalesce(jsonb_typeof(p_camera), '') <> 'object')
    or (p_anchor_kind = 'point' and coalesce(jsonb_typeof(p_point), '') <> 'object')
    or (p_anchor_kind = 'region' and coalesce(jsonb_typeof(p_region), '') <> 'object') then
    perform projectceo_product._raise('P1111', 'validation_failed', '{}'::jsonb);
  end if;
  perform projectceo_foundation._assert_state_revision(p_expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'projectId', p_project_id, 'packageId', p_package_id,
    'representationVersionId', p_representation_version_id,
    'objectRevisionId', p_object_revision_id,
    'technicalReferenceRevisionId', p_technical_reference_revision_id,
    'anchorKind', p_anchor_kind, 'camera', p_camera, 'point', p_point,
    'region', p_region, 'body', p_body, 'expectedStateRevision', p_expected_state_revision
  ));
  select workflow.state_revision into v_state_revision
  from project_intelligence.project_workflows workflow
  where workflow.organization_id = v_context.organization_id and workflow.project_id = p_project_id
  for update;
  v_replay := projectceo_product._replay_or_null(v_context.organization_id, p_project_id, 'create_external_annotation', v_key_digest, v_request_digest);
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> p_expected_state_revision then
    perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentStateRevision', v_state_revision));
  end if;
  select representation.server_sha256 into v_representation_sha
  from projectceo_foundation.external_representation_versions representation
  where representation.organization_id = v_context.organization_id
    and representation.project_id = p_project_id
    and representation.package_id = p_package_id
    and representation.representation_version_id = p_representation_version_id;
  if not found then perform projectceo_product._raise('P1204', 'not_found', '{}'::jsonb); end if;
  insert into projectceo_foundation.external_annotation_revisions (
    organization_id, project_id, package_id, annotation_id, annotation_revision_id,
    revision_no, representation_version_id, representation_sha256, object_revision_id,
    technical_reference_revision_id, anchor_kind, camera, point, region, body,
    created_by_user_id, causation_id, request_id
  ) values (
    v_context.organization_id, p_project_id, p_package_id, v_annotation_id, v_annotation_revision_id,
    1, p_representation_version_id, v_representation_sha, p_object_revision_id,
    p_technical_reference_revision_id, p_anchor_kind, p_camera, p_point, p_region, p_body,
    v_context.actor_user_id, 'command:' || v_annotation_id::text, 'annotation:' || v_annotation_revision_id::text
  );
  v_result := jsonb_build_object('annotationId', v_annotation_id, 'annotationRevisionId', v_annotation_revision_id, 'representationDigest', 'sha256:' || encode(v_representation_sha, 'hex'));
  return projectceo_product._complete_command(
    v_context.organization_id, p_project_id, 'create_external_annotation', v_key_digest, v_request_digest,
    'human', v_context.actor_id, v_context.actor_user_id, v_result, 'external_annotation_created',
    jsonb_build_object('annotation_id', v_annotation_id, 'annotation_revision_id', v_annotation_revision_id, 'package_id', p_package_id), v_state_revision
  );
end
$function$;

create function projectceo_product_api.revise_external_annotation(
  p_project_id uuid,
  p_package_id uuid,
  p_annotation_id uuid,
  p_expected_annotation_revision_id uuid,
  p_anchor_kind text,
  p_camera jsonb,
  p_point jsonb,
  p_region jsonb,
  p_body text,
  p_expected_state_revision bigint,
  p_idempotency_key text
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
  v_previous projectceo_foundation.external_annotation_revisions%rowtype;
  v_annotation_revision_id uuid := extensions.gen_random_uuid();
  v_key_digest bytea;
  v_request_digest bytea;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_context from projectceo_foundation._authorize_package_human(p_project_id, p_package_id, 'review_selection');
  select membership.role into v_role from projectceo_foundation.package_memberships membership
  where membership.organization_id = v_context.organization_id and membership.project_id = p_project_id
    and membership.package_id = p_package_id and membership.user_id = v_context.actor_user_id
    and membership.status = 'active';
  if v_role is distinct from 'client_approver' then perform projectceo_product._raise('P1103', 'forbidden', '{}'::jsonb); end if;
  if p_anchor_kind not in ('camera', 'point', 'region') or p_body is null
    or char_length(btrim(p_body)) not between 1 and 5000 or p_body <> btrim(p_body)
    or p_body ~ '[[:cntrl:]]'
    or (p_anchor_kind = 'camera' and coalesce(jsonb_typeof(p_camera), '') <> 'object')
    or (p_anchor_kind = 'point' and coalesce(jsonb_typeof(p_point), '') <> 'object')
    or (p_anchor_kind = 'region' and coalesce(jsonb_typeof(p_region), '') <> 'object') then
    perform projectceo_product._raise('P1111', 'validation_failed', '{}'::jsonb);
  end if;
  perform projectceo_foundation._assert_state_revision(p_expected_state_revision);
  perform projectceo_foundation._assert_idempotency_key(p_idempotency_key);
  v_key_digest := project_intelligence._sha256_text(btrim(p_idempotency_key));
  v_request_digest := project_intelligence._sha256_jsonb(jsonb_build_object(
    'projectId', p_project_id, 'packageId', p_package_id, 'annotationId', p_annotation_id,
    'expectedAnnotationRevisionId', p_expected_annotation_revision_id, 'anchorKind', p_anchor_kind,
    'camera', p_camera, 'point', p_point, 'region', p_region, 'body', p_body,
    'expectedStateRevision', p_expected_state_revision
  ));
  select workflow.state_revision into v_state_revision from project_intelligence.project_workflows workflow
  where workflow.organization_id = v_context.organization_id and workflow.project_id = p_project_id for update;
  v_replay := projectceo_product._replay_or_null(v_context.organization_id, p_project_id, 'revise_external_annotation', v_key_digest, v_request_digest);
  if v_replay is not null then return v_replay; end if;
  if v_state_revision <> p_expected_state_revision then perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentStateRevision', v_state_revision)); end if;
  select * into v_previous from projectceo_foundation.external_annotation_revisions annotation
  where annotation.organization_id = v_context.organization_id and annotation.project_id = p_project_id
    and annotation.package_id = p_package_id and annotation.annotation_id = p_annotation_id
  order by annotation.revision_no desc limit 1 for update;
  if not found then perform projectceo_product._raise('P1204', 'not_found', '{}'::jsonb); end if;
  if v_previous.annotation_revision_id is distinct from p_expected_annotation_revision_id then
    perform projectceo_product._raise('P1107', 'stale_state', jsonb_build_object('currentRevisionId', v_previous.annotation_revision_id));
  end if;
  if v_previous.created_by_user_id is distinct from v_context.actor_user_id then perform projectceo_product._raise('P1103', 'forbidden', '{}'::jsonb); end if;
  insert into projectceo_foundation.external_annotation_revisions (
    organization_id, project_id, package_id, annotation_id, annotation_revision_id, revision_no,
    supersedes_annotation_revision_id, representation_version_id, representation_sha256,
    object_revision_id, technical_reference_revision_id, anchor_kind, camera, point, region,
    body, created_by_user_id, causation_id, request_id
  ) values (
    v_context.organization_id, p_project_id, p_package_id, p_annotation_id, v_annotation_revision_id,
    v_previous.revision_no + 1, v_previous.annotation_revision_id, v_previous.representation_version_id,
    v_previous.representation_sha256, v_previous.object_revision_id, v_previous.technical_reference_revision_id,
    p_anchor_kind, p_camera, p_point, p_region, p_body, v_context.actor_user_id,
    'command:' || p_annotation_id::text, 'annotation:' || v_annotation_revision_id::text
  );
  v_result := jsonb_build_object('annotationId', p_annotation_id, 'annotationRevisionId', v_annotation_revision_id, 'supersedesAnnotationRevisionId', v_previous.annotation_revision_id);
  return projectceo_product._complete_command(v_context.organization_id, p_project_id, 'revise_external_annotation', v_key_digest, v_request_digest, 'human', v_context.actor_id, v_context.actor_user_id, v_result, 'external_annotation_revised', jsonb_build_object('annotation_id', p_annotation_id, 'annotation_revision_id', v_annotation_revision_id, 'package_id', p_package_id), v_state_revision);
end
$function$;

alter function projectceo_foundation.assert_r1_annotation_target() owner to pi_table_owner;
alter function projectceo_product_api.create_external_annotation(uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,bigint,text) owner to pi_table_owner;
alter function projectceo_product_api.revise_external_annotation(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,bigint,text) owner to pi_table_owner;
revoke all on function projectceo_foundation.assert_r1_annotation_target() from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_product_api.create_external_annotation(uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,bigint,text) from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_product_api.revise_external_annotation(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,bigint,text) from public, anon, service_role, pi_human_executor, pi_worker_executor;
grant execute on function projectceo_product_api.create_external_annotation(uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,bigint,text) to authenticated;
grant execute on function projectceo_product_api.revise_external_annotation(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,bigint,text) to authenticated;

commit;
