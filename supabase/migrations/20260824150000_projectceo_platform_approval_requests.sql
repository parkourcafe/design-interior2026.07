-- Platform foundation A4: переиспользуемый Approval Requests gate (Фаза 2).
--
-- ЧТО ЭТО. Общая сущность согласования для любой сущности платформы
-- (subject_kind + subject_id): заявка → рассмотрение → решение, с честным
-- маркером самоодобрения (DEC-010: «Self approval явно маркируется — не
-- выдавать за independent review»). M2 approval_packages НЕ переписываются
-- (неизменяемая история доказанного контура) — эта сущность рядом, для
-- всего, что ещё не имеет своего согласования.
--
-- СТАТУСНАЯ МАШИНА. draft → submitted → approved | rejected. Триггер
-- допускает только эти переходы; решённая заявка неизменяема. Решение
-- требует capability, ЗАПИСАННОЙ В САМОЙ ЗАЯВКЕ (approver_capability) —
-- авторизация динамическая, через _authorize_project_human.
--
-- DEC-010. Решение запрашивающим разрешено, но честно маркируется:
-- self_approved = true, когда decided_by = requested_by. Маркер — данные,
-- не скрытие.
--
-- СОБЫТИЯ. approval_request_events — append-only (insert-only триггер):
-- created/submitted/approved/rejected с актором и причиной.
--
-- ЧЕГО ЗДЕСЬ НЕТ. Ни делегирований, ни мульти-аппрува, ни эскалаций, ни
-- сроков, ни UI. Командная дверь — командный контракт A1
-- (_human_command_context), операции добавлены в command_records/audit.

begin;

create table projectceo_platform.approval_requests (
  organization_id uuid not null,
  project_id uuid not null,
  request_id uuid not null default extensions.gen_random_uuid(),
  subject_kind text not null
    check (char_length(btrim(subject_kind)) between 1 and 80),
  subject_id text not null
    check (char_length(btrim(subject_id)) between 1 and 160),
  approver_capability text not null
    check (char_length(btrim(approver_capability)) between 1 and 80),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  requested_by uuid not null,
  requested_reason text not null
    check (char_length(btrim(requested_reason)) between 1 and 2000),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text
    check (decision_reason is null or char_length(btrim(decision_reason)) between 1 and 2000),
  self_approved boolean not null default false,
  created_at timestamptz not null default now(),
  decided_shape_at timestamptz not null default now(),
  primary key (organization_id, project_id, request_id),
  constraint approval_requests_workflow_fkey
    foreign key (organization_id, project_id)
    references project_intelligence.project_workflows (organization_id, project_id),
  -- Форма: решённая заявка несёт решившего, момент и причину; нерешённая —
  -- не несёт ничего из этого. Constraint, не соглашение.
  constraint approval_requests_decision_shape_check check (
    (
      status in ('approved', 'rejected')
      and decided_by is not null
      and decided_at is not null
      and decision_reason is not null
    )
    or
    (
      status in ('draft', 'submitted')
      and decided_by is null
      and decided_at is null
      and decision_reason is null
      and self_approved = false
    )
  )
);

create index approval_requests_active_idx
  on projectceo_platform.approval_requests (organization_id, project_id, status)
  where status in ('draft', 'submitted');

-- Переходы только вперёд по машине; решённая — неизменяема.
create function projectceo_platform.guard_approval_request_transition()
returns trigger
language plpgsql
as $function$
begin
  if old.status = 'draft' and new.status = 'submitted' then
    return new;
  end if;
  if old.status = 'submitted'
    and new.status in ('approved', 'rejected') then
    return new;
  end if;
  raise exception using
    errcode = '55000',
    message = 'PROJECTCEO_PLATFORM_APPROVAL_TRANSITION_ILLEGAL',
    detail = format('%s -> %s', old.status, new.status);
end
$function$;

create trigger approval_requests_transition_guard
  before update on projectceo_platform.approval_requests
  for each row execute function projectceo_platform.guard_approval_request_transition();

create table projectceo_platform.approval_request_events (
  organization_id uuid not null,
  project_id uuid not null,
  request_id uuid not null,
  event_no bigint not null,
  event_type text not null
    check (event_type in ('created', 'submitted', 'approved', 'rejected')),
  actor_user_id uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (organization_id, project_id, request_id, event_no),
  constraint approval_request_events_request_fkey
    foreign key (organization_id, project_id, request_id)
    references projectceo_platform.approval_requests (organization_id, project_id, request_id)
);

create function projectceo_platform.reject_approval_event_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'PROJECTCEO_PLATFORM_APPROVAL_EVENTS_IMMUTABLE';
end
$function$;

create trigger approval_request_events_append_only
  before update or delete on projectceo_platform.approval_request_events
  for each row execute function projectceo_platform.reject_approval_event_mutation();

alter table projectceo_platform.approval_requests enable row level security;
alter table projectceo_platform.approval_requests force row level security;
revoke all on table projectceo_platform.approval_requests
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter table projectceo_platform.approval_requests owner to pi_table_owner;
create policy approval_requests_internal_owner
  on projectceo_platform.approval_requests
  for all to pi_table_owner using (true) with check (true);

alter table projectceo_platform.approval_request_events enable row level security;
alter table projectceo_platform.approval_request_events force row level security;
revoke all on table projectceo_platform.approval_request_events
  from public, anon, authenticated, service_role,
       pi_human_executor, pi_worker_executor;
alter table projectceo_platform.approval_request_events owner to pi_table_owner;
create policy approval_request_events_internal_owner
  on projectceo_platform.approval_request_events
  for all to pi_table_owner using (true) with check (true);

-- === Двери ==================================================================

-- Создание заявки: любой член проекта (view_project).
create function projectceo_platform_api.create_approval_request(
  p_project_id uuid,
  p_subject_kind text,
  p_subject_id text,
  p_approver_capability text,
  p_reason text,
  p_expected_state_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_request_id uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  if p_subject_kind is null or btrim(p_subject_kind) = ''
    or char_length(btrim(p_subject_kind)) > 80 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"subjectKind"}'::jsonb);
  end if;
  if p_subject_id is null or btrim(p_subject_id) = ''
    or char_length(btrim(p_subject_id)) > 160 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"subjectId"}'::jsonb);
  end if;
  if p_approver_capability is null or btrim(p_approver_capability) = ''
    or char_length(btrim(p_approver_capability)) > 80 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"approverCapability"}'::jsonb);
  end if;
  if p_reason is null or btrim(p_reason) = ''
    or char_length(btrim(p_reason)) > 2000 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"reason"}'::jsonb);
  end if;

  select * into v_context
  from projectceo_platform._human_command_context(
    p_project_id, 'view_project', 'create_approval_request',
    p_expected_state_revision, p_idempotency_key,
    jsonb_build_object(
      'subjectKind', btrim(p_subject_kind),
      'subjectId', btrim(p_subject_id),
      'approverCapability', btrim(p_approver_capability)
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;

  insert into projectceo_platform.approval_requests (
    organization_id, project_id, request_id,
    subject_kind, subject_id, approver_capability,
    status, requested_by, requested_reason
  ) values (
    v_context.organization_id, p_project_id, v_request_id,
    btrim(p_subject_kind), btrim(p_subject_id), btrim(p_approver_capability),
    'draft', v_context.actor_user_id, btrim(p_reason)
  );

  insert into projectceo_platform.approval_request_events (
    organization_id, project_id, request_id, event_no,
    event_type, actor_user_id, reason
  ) values (
    v_context.organization_id, p_project_id, v_request_id, 1,
    'created', v_context.actor_user_id, btrim(p_reason)
  );

  v_result := jsonb_build_object(
    'requestId', v_request_id,
    'status', 'draft',
    'approverCapability', btrim(p_approver_capability)
  );
  return projectceo_product._complete_command(
    v_context.organization_id, p_project_id,
    'create_approval_request',
    v_context.key_digest, v_context.request_digest,
    'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'platform_approval_request_created',
    jsonb_build_object('request_id', v_request_id),
    v_context.state_revision
  );
end
$function$;

-- Подача: только заявителем, draft → submitted.
create function projectceo_platform_api.submit_approval_request(
  p_project_id uuid,
  p_request_id uuid,
  p_expected_state_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_request projectceo_platform.approval_requests%rowtype;
  v_result jsonb;
begin
  select * into v_context
  from projectceo_platform._human_command_context(
    p_project_id, 'view_project', 'submit_approval_request',
    p_expected_state_revision, p_idempotency_key,
    jsonb_build_object('requestId', p_request_id)
  );
  if v_context.replay is not null then return v_context.replay; end if;

  select * into v_request
  from projectceo_platform.approval_requests r
  where r.organization_id = v_context.organization_id
    and r.project_id = p_project_id
    and r.request_id = p_request_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"approvalRequest"}'::jsonb);
  end if;
  if v_request.requested_by <> v_context.actor_user_id then
    perform projectceo_product._raise(
      'P1103', 'forbidden', '{"reason":"ONLY_REQUESTER_SUBMITS"}'::jsonb);
  end if;
  if v_request.status <> 'draft' then
    perform projectceo_product._raise(
      'P1110',
      'unsupported_source',
      jsonb_build_object('reason', 'APPROVAL_REQUEST_NOT_DRAFT',
                         'status', v_request.status)
    );
  end if;

  update projectceo_platform.approval_requests r
  set status = 'submitted'
  where r.organization_id = v_context.organization_id
    and r.project_id = p_project_id
    and r.request_id = p_request_id;

  insert into projectceo_platform.approval_request_events (
    organization_id, project_id, request_id, event_no,
    event_type, actor_user_id
  ) values (
    v_context.organization_id, p_project_id, p_request_id, 2,
    'submitted', v_context.actor_user_id
  );

  v_result := jsonb_build_object('requestId', p_request_id, 'status', 'submitted');
  return projectceo_product._complete_command(
    v_context.organization_id, p_project_id,
    'submit_approval_request',
    v_context.key_digest, v_context.request_digest,
    'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'platform_approval_request_submitted',
    jsonb_build_object('request_id', p_request_id),
    v_context.state_revision
  );
end
$function$;

-- Решение: capability ИЗ ЗАЯВКИ; самоодобрение честно маркируется (DEC-010).
create function projectceo_platform_api.decide_approval_request(
  p_project_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reason text,
  p_expected_state_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_context record;
  v_request projectceo_platform.approval_requests%rowtype;
  v_self boolean;
  v_event_no bigint;
  v_result jsonb;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"decision"}'::jsonb);
  end if;
  if p_reason is null or btrim(p_reason) = ''
    or char_length(btrim(p_reason)) > 2000 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"reason"}'::jsonb);
  end if;

  select * into v_context
  from projectceo_platform._human_command_context(
    p_project_id, 'view_project', 'decide_approval_request',
    p_expected_state_revision, p_idempotency_key,
    jsonb_build_object('requestId', p_request_id, 'decision', p_decision)
  );
  if v_context.replay is not null then return v_context.replay; end if;

  select * into v_request
  from projectceo_platform.approval_requests r
  where r.organization_id = v_context.organization_id
    and r.project_id = p_project_id
    and r.request_id = p_request_id;
  if not found then
    perform projectceo_product._raise(
      'P1104', 'not_found', '{"entity":"approvalRequest"}'::jsonb);
  end if;
  if v_request.status <> 'submitted' then
    perform projectceo_product._raise(
      'P1110',
      'unsupported_source',
      jsonb_build_object('reason', 'APPROVAL_REQUEST_NOT_SUBMITTED',
                         'status', v_request.status)
    );
  end if;

  -- Динамическая авторизация: решает тот, у кого есть capability,
  -- ЗАПИСАННАЯ В ЗАЯВКЕ её автором.
  perform projectceo_foundation._authorize_project_human(
    p_project_id, v_request.approver_capability
  );

  v_self := v_request.requested_by = v_context.actor_user_id;

  update projectceo_platform.approval_requests r
  set status = p_decision,
      decided_by = v_context.actor_user_id,
      decided_at = now(),
      decision_reason = btrim(p_reason),
      self_approved = v_self
  where r.organization_id = v_context.organization_id
    and r.project_id = p_project_id
    and r.request_id = p_request_id;

  select coalesce(max(e.event_no), 1) + 1 into v_event_no
  from projectceo_platform.approval_request_events e
  where e.organization_id = v_context.organization_id
    and e.project_id = p_project_id
    and e.request_id = p_request_id;

  insert into projectceo_platform.approval_request_events (
    organization_id, project_id, request_id, event_no,
    event_type, actor_user_id, reason
  ) values (
    v_context.organization_id, p_project_id, p_request_id, v_event_no,
    p_decision, v_context.actor_user_id, btrim(p_reason)
  );

  v_result := jsonb_build_object(
    'requestId', p_request_id,
    'status', p_decision,
    'selfApproved', v_self
  );
  return projectceo_product._complete_command(
    v_context.organization_id, p_project_id,
    'decide_approval_request',
    v_context.key_digest, v_context.request_digest,
    'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'platform_approval_request_decided',
    jsonb_build_object('request_id', p_request_id, 'decision', p_decision,
                       'self_approved', v_self),
    v_context.state_revision
  );
end
$function$;

-- Чтение: любой член проекта, решённые и поданные видны.
create function projectceo_platform_api.list_approval_requests(
  p_project_id uuid,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
#variable_conflict use_variable
declare
  v_organization_id uuid;
  v_data jsonb;
begin
  if p_status is not null and p_status not in
    ('draft', 'submitted', 'approved', 'rejected') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"status"}'::jsonb);
  end if;

  select context.organization_id into v_organization_id
  from projectceo_foundation._authorize_project_human(
    p_project_id, 'view_project'
  ) context;

  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', r.request_id,
    'subjectKind', r.subject_kind,
    'subjectId', r.subject_id,
    'approverCapability', r.approver_capability,
    'status', r.status,
    'requestedReason', r.requested_reason,
    'selfApproved', r.self_approved,
    'decidedBy', r.decided_by,
    'decisionReason', r.decision_reason,
    'createdAt', r.created_at
  ) order by r.created_at, r.request_id), '[]'::jsonb) into v_data
  from projectceo_platform.approval_requests r
  where r.organization_id = v_organization_id
    and r.project_id = p_project_id
    and (p_status is null or r.status = p_status);

  return jsonb_build_object('requests', v_data);
end
$function$;

-- Владение и гранты: create/submit/decide/list — authenticated
-- (авторизация внутри), owner pi_table_owner.
alter function projectceo_platform_api.create_approval_request(
  uuid, text, text, text, text, bigint, text
) owner to pi_table_owner;
alter function projectceo_platform_api.submit_approval_request(
  uuid, uuid, bigint, text
) owner to pi_table_owner;
alter function projectceo_platform_api.decide_approval_request(
  uuid, uuid, text, text, bigint, text
) owner to pi_table_owner;
alter function projectceo_platform_api.list_approval_requests(uuid, text)
  owner to pi_table_owner;

revoke all on function projectceo_platform_api.create_approval_request(
  uuid, text, text, text, text, bigint, text
) from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_platform_api.submit_approval_request(
  uuid, uuid, bigint, text
) from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_platform_api.decide_approval_request(
  uuid, uuid, text, text, bigint, text
) from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_platform_api.list_approval_requests(uuid, text)
  from public, anon, service_role, pi_human_executor, pi_worker_executor;

grant execute on function projectceo_platform_api.create_approval_request(
  uuid, text, text, text, text, bigint, text
) to authenticated;
grant execute on function projectceo_platform_api.submit_approval_request(
  uuid, uuid, bigint, text
) to authenticated;
grant execute on function projectceo_platform_api.decide_approval_request(
  uuid, uuid, text, text, bigint, text
) to authenticated;
grant execute on function projectceo_platform_api.list_approval_requests(uuid, text)
  to authenticated;

-- === Реестры операций и событий =============================================

alter table projectceo_product.command_records
  drop constraint command_records_operation_check;
alter table projectceo_product.command_records
  add constraint command_records_operation_check
  check (operation = ANY (ARRAY[
    'review_claim'::text, 'publish_version'::text, 'revise_decision'::text,
    'calculate_impact'::text, 'review_impact'::text, 'build_handoff'::text,
    'enroll_organization_project'::text, 'create_invitation'::text,
    'accept_invitation'::text, 'revoke_invitation'::text,
    'expire_invitation'::text, 'create_guest_access_grant'::text,
    'revoke_guest_access_grant'::text, 'register_source_inventory'::text,
    'ingest_source_graph'::text,
    'append_decision_revision'::text, 'append_selection_revision'::text,
    'append_price_observation'::text, 'append_system_decision_revision'::text,
    'append_system_selection_revision'::text, 'create_approval_package'::text,
    'submit_approval_package'::text, 'review_approval_package'::text,
    'publish_project_baseline'::text, 'publish_production_package_version'::text,
    'build_release_artifact'::text, 'distribute_release'::text,
    'distribute_release_request_bound'::text, 'acknowledge_release'::text,
    'acknowledge_release_request_bound'::text, 'approve_no_change'::text,
    'submit_change_request'::text, 'calculate_change_impact'::text,
    'review_change_impact'::text, 'define_milestone'::text,
    'register_photo_evidence'::text, 'review_photo_evidence'::text,
    'accept_milestone'::text, 'register_handover_document'::text,
    'build_construction_handover'::text, 'append_m2_room_revision'::text,
    'append_m2_variant_revision'::text, 'append_m2_material_revision'::text,
    'append_m2_budget_revision'::text, 'append_m2_client_handoff_revision'::text,
    'append_m2_approved_commit_revision'::text, 'append_m2_layout_version_revision'::text,
    'submit_m2_client_review'::text, 'review_m2_client_submission'::text,
    'publish_m2_m3_handoff'::text, 'register_m3_documentation_sheet'::text,
    'attach_m3_documentation_sheet_specifications'::text,
    'acknowledge_impact_truncation'::text, 'create_project_fact'::text,
    'create_approval_request'::text, 'submit_approval_request'::text,
    'decide_approval_request'::text
  ]));

alter table projectceo_product.audit_events
  drop constraint audit_events_event_type_check;
alter table projectceo_product.audit_events
  add constraint audit_events_event_type_check
  check (event_type = ANY (ARRAY[
    'decision_revision_appended'::text, 'selection_revision_appended'::text,
    'price_observation_appended'::text, 'approval_package_created'::text,
    'approval_package_submitted'::text, 'approval_package_reviewed'::text,
    'project_baseline_published'::text,
    'production_package_version_published'::text,
    'release_artifact_built'::text, 'release_distributed'::text,
    'release_acknowledged'::text, 'no_change_approved'::text,
    'change_request_submitted'::text, 'change_impact_calculated'::text,
    'change_impact_reviewed'::text, 'milestone_defined'::text,
    'photo_evidence_registered'::text, 'photo_evidence_reviewed'::text,
    'milestone_accepted'::text, 'handover_document_registered'::text,
    'construction_handover_built'::text, 'm2_room_revision_appended'::text,
    'm2_variant_revision_appended'::text, 'm2_material_revision_appended'::text,
    'm2_budget_revision_appended'::text, 'm2_client_handoff_revision_appended'::text,
    'm2_approved_commit_revision_appended'::text,
    'm2_layout_version_revision_appended'::text,
    'm2_client_review_submitted'::text, 'm2_client_submission_reviewed'::text,
    'm2_m3_handoff_published'::text, 'm3_documentation_sheet_registered'::text,
    'm3_documentation_sheet_specifications_attached'::text,
    'change_impact_truncation_acknowledged'::text, 'project_fact_created'::text,
    'platform_approval_request_created'::text,
    'platform_approval_request_submitted'::text,
    'platform_approval_request_decided'::text
  ]));

-- === Guard ==================================================================

do $guard$
declare
  v_tables integer;
begin
  select count(*) into v_tables
  from information_schema.tables
  where table_schema = 'projectceo_platform'
    and table_name in ('approval_requests', 'approval_request_events');
  if v_tables <> 2 then
    raise exception 'PROJECTCEO_PLATFORM_APPROVAL_TABLES_MISSING:%', v_tables;
  end if;

  if has_function_privilege(
    'anon',
    'projectceo_platform_api.decide_approval_request(uuid,uuid,text,text,bigint,text)',
    'execute'
  ) then
    raise exception 'PROJECTCEO_PLATFORM_APPROVAL_DECIDE_REACHABLE_BY_ANON';
  end if;
end
$guard$;

commit;
