-- Aldo AW-01: append-only seven-stage project path. This is intentionally a
-- private projection; callers use the request-bound read/command doors below.
begin;

create table projectceo_platform.project_stage_revisions (
  organization_id uuid not null,
  project_id uuid not null,
  stage_revision_id uuid not null default extensions.gen_random_uuid(),
  stage_id text not null check (stage_id in (
    '01_brief','02_concept_offer','03_preliminary_design',
    '04_design_development','05_technical_documentation',
    '06_preconstruction','07_construction_closeout'
  )),
  revision_no integer not null check (revision_no > 0),
  result_revision_id text,
  owner_user_id uuid not null,
  planned_at timestamptz,
  actual_at timestamptz,
  blocker_reason text,
  requirements jsonb not null default '[]'::jsonb
    check (jsonb_typeof(requirements)='array'),
  approval_status text check (approval_status in ('draft','submitted','approved','rejected','change_requested')),
  approval_revision_id text,
  not_applicable_reason text,
  not_applicable_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  primary key (organization_id, project_id, stage_revision_id),
  unique (organization_id, project_id, stage_id, revision_no),
  foreign key (organization_id, project_id) references project_intelligence.project_workflows(organization_id, project_id) on delete restrict,
  foreign key (organization_id, owner_user_id) references project_intelligence.organization_members(organization_id, user_id) on delete restrict,
  foreign key (organization_id, created_by) references project_intelligence.organization_members(organization_id, user_id) on delete restrict,
  foreign key (organization_id, not_applicable_by) references project_intelligence.organization_members(organization_id, user_id) on delete restrict,
  check (blocker_reason is null or char_length(btrim(blocker_reason)) between 1 and 4000),
  check ((approval_status is null and approval_revision_id is null) or (approval_status is not null and approval_revision_id=result_revision_id)),
  check ((not_applicable_reason is null and not_applicable_by is null) or (not_applicable_reason is not null and not_applicable_by is not null and result_revision_id is null and approval_status is null)),
  check (result_revision_id is not null or not_applicable_reason is not null)
);

create index project_stage_revisions_current_idx
  on projectceo_platform.project_stage_revisions (organization_id, project_id, stage_id, revision_no desc);
alter table projectceo_platform.project_stage_revisions enable row level security;
alter table projectceo_platform.project_stage_revisions force row level security;
alter table projectceo_platform.project_stage_revisions owner to pi_table_owner;
revoke all on table projectceo_platform.project_stage_revisions from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
create policy project_stage_revisions_internal_owner on projectceo_platform.project_stage_revisions
  for all to pi_table_owner using (true) with check (true);

create function projectceo_platform.reject_project_stage_revision_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000', message='PROJECT_STAGE_REVISION_APPEND_ONLY';
end
$function$;
create trigger project_stage_revisions_append_only
  before update or delete on projectceo_platform.project_stage_revisions
  for each row execute function projectceo_platform.reject_project_stage_revision_mutation();

do $extend_stage_command_registry$
declare operations text[]; events text[];
begin
  select array_agg(match[1] order by match[1]) into operations
  from pg_catalog.pg_constraint c,
    lateral regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), $re$'([a-z0-9_]+)'$re$, 'g') match
  where c.conname='command_records_operation_check'
    and c.conrelid='projectceo_foundation.command_records'::regclass;
  select array_agg(match[1] order by match[1]) into events
  from pg_catalog.pg_constraint c,
    lateral regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), $re$'([a-z0-9_]+)'$re$, 'g') match
  where c.conname='audit_events_event_type_check'
    and c.conrelid='projectceo_foundation.audit_events'::regclass;
  if operations is null or events is null then raise exception 'ALDO_STAGE_COMMAND_REGISTRY_MISSING'; end if;
  alter table projectceo_foundation.command_records drop constraint command_records_operation_check;
  execute format('alter table projectceo_foundation.command_records add constraint command_records_operation_check check (operation=any(array[%s]))',
    (select string_agg(quote_literal(value),',' order by value) from (select distinct value from unnest(operations||array['record_project_stage_revision']) value) x));
  alter table projectceo_foundation.audit_events drop constraint audit_events_event_type_check;
  execute format('alter table projectceo_foundation.audit_events add constraint audit_events_event_type_check check (event_type=any(array[%s]))',
    (select string_agg(quote_literal(value),',' order by value) from (select distinct value from unnest(events||array['project_stage_revision_recorded']) value) x));
end
$extend_stage_command_registry$;

create function projectceo_platform_api.record_project_stage_revision(
  project_id uuid, stage_id text, result_revision_id text, owner_user_id uuid,
  planned_at timestamptz, actual_at timestamptz, blocker_reason text,
  requirements jsonb, approval_status text, approval_revision_id text,
  not_applicable_reason text, expected_state_revision bigint, idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare ctx record; role_name text; state_value bigint; revision_no integer; key_digest bytea; request_digest bytea; replay jsonb; result jsonb;
begin
  perform projectceo_foundation._assert_idempotency_key(idempotency_key);
  perform projectceo_foundation._assert_state_revision(expected_state_revision);
  select * into strict ctx from projectceo_foundation._authorize_project_human(project_id,'view_project');
  select membership.role into strict role_name from projectceo_foundation.project_memberships membership
   where membership.organization_id=ctx.organization_id and membership.project_id=record_project_stage_revision.project_id
     and membership.user_id=ctx.actor_user_id and membership.status='active';
  if role_name not in ('owner_lead','architect') then
    perform projectceo_foundation._raise('P1103','forbidden','{"reason":"STAGE_EDITOR_REQUIRED"}'::jsonb);
  end if;
  if stage_id not in ('01_brief','02_concept_offer','03_preliminary_design','04_design_development','05_technical_documentation','06_preconstruction','07_construction_closeout')
    or jsonb_typeof(requirements) <> 'array' then
    perform projectceo_foundation._raise('P1111','validation_failed','{"field":"stage"}'::jsonb);
  end if;
  select workflow.state_revision into strict state_value from project_intelligence.project_workflows workflow
   where workflow.organization_id=ctx.organization_id and workflow.project_id=record_project_stage_revision.project_id for update;
  key_digest:=project_intelligence._sha256_text(btrim(idempotency_key));
  request_digest:=project_intelligence._sha256_jsonb(jsonb_build_object('stageId',stage_id,'resultRevisionId',result_revision_id,'ownerUserId',owner_user_id,'plannedAt',planned_at,'actualAt',actual_at,'blockerReason',blocker_reason,'requirements',requirements,'approvalStatus',approval_status,'approvalRevisionId',approval_revision_id,'notApplicableReason',not_applicable_reason,'expectedStateRevision',expected_state_revision));
  replay:=projectceo_foundation._replay_or_null(ctx.organization_id,project_id,'record_project_stage_revision',key_digest,request_digest);
  if replay is not null then return replay; end if;
  if state_value<>expected_state_revision then perform projectceo_foundation._raise('P1107','stale_state',jsonb_build_object('currentStateRevision',state_value)); end if;
  select coalesce(max(row.revision_no),0)+1 into revision_no from projectceo_platform.project_stage_revisions row where row.organization_id=ctx.organization_id and row.project_id=record_project_stage_revision.project_id and row.stage_id=record_project_stage_revision.stage_id;
  insert into projectceo_platform.project_stage_revisions(organization_id,project_id,stage_id,revision_no,result_revision_id,owner_user_id,planned_at,actual_at,blocker_reason,requirements,approval_status,approval_revision_id,not_applicable_reason,not_applicable_by,created_by)
  values(ctx.organization_id,project_id,stage_id,revision_no,result_revision_id,owner_user_id,planned_at,actual_at,blocker_reason,requirements,approval_status,approval_revision_id,not_applicable_reason,case when not_applicable_reason is null then null else ctx.actor_user_id end,ctx.actor_user_id)
  returning jsonb_build_object('stageId',stage_id,'revisionId',stage_revision_id,'revisionNo',revision_no,'resultRevisionId',result_revision_id) into result;
  return projectceo_foundation._complete_project_command(ctx.organization_id,project_id,'record_project_stage_revision',key_digest,request_digest,'human',ctx.actor_id,ctx.actor_user_id,result,'project_stage_revision_recorded',jsonb_build_object('stage_id',stage_id,'stage_revision_id',result->>'revisionId'),state_value);
end
$function$;

create function projectceo_platform_api.get_project_stage_revisions(project_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare ctx record; data jsonb;
begin
  select * into strict ctx from projectceo_foundation._authorize_project_human(project_id,'view_project');
  select coalesce(jsonb_agg(jsonb_build_object(
    'stageId', row.stage_id, 'revisionId', row.stage_revision_id,
    'revisionNo', row.revision_no, 'resultRevisionId', row.result_revision_id,
    'ownerUserId', row.owner_user_id, 'plannedAt', row.planned_at,
    'actualAt', row.actual_at, 'blockerReason', row.blocker_reason,
    'requirements', row.requirements, 'approvalStatus', row.approval_status,
    'approvalRevisionId', row.approval_revision_id,
    'notApplicableReason', row.not_applicable_reason,
    'notApplicableBy', row.not_applicable_by, 'createdAt', row.created_at
  ) order by row.stage_id, row.revision_no), '[]'::jsonb) into data
  from projectceo_platform.project_stage_revisions row
  where row.organization_id=ctx.organization_id and row.project_id=get_project_stage_revisions.project_id;
  return jsonb_build_object('stages',data);
end
$function$;

alter function projectceo_platform_api.get_project_stage_revisions(uuid) owner to pi_table_owner;
alter function projectceo_platform_api.record_project_stage_revision(uuid,text,text,uuid,timestamptz,timestamptz,text,jsonb,text,text,text,bigint,text) owner to pi_table_owner;
revoke all on function projectceo_platform_api.get_project_stage_revisions(uuid) from public, anon, service_role, pi_human_executor, pi_worker_executor;
grant usage on schema projectceo_platform_api to authenticated;
grant execute on function projectceo_platform_api.get_project_stage_revisions(uuid) to authenticated;
grant execute on function projectceo_platform_api.record_project_stage_revision(uuid,text,text,uuid,timestamptz,timestamptz,text,jsonb,text,text,text,bigint,text) to authenticated;
commit;
