-- DEC-041 §3 (OWNER DECISION 27.09.2026): полномочия одобрения паспорта.
--
-- До этой миграции право, нужное для решения по заявке, выбирал её автор
-- (p_approver_capability в create_approval_request). Любой участник проекта
-- с view_project — строитель, клиент — мог прямым RPC создать заявку
-- project_passport с правом, которое есть у него самого, одобрить её и
-- открыть отправку КП (guard_proposal_lifecycle, миграция 20260925090000).
-- Одобрение не было привязано к ревизии паспорта: после повторного брифа
-- старое одобрение продолжало открывать отправку.
--
-- Правило DEC-041 §3:
--   * одобряющего определяет сервер по авторизованному контексту; автор
--     заявки роль одобряющего не задаёт;
--   * паспорт одобряет владелец проекта (активное членство owner_lead);
--   * архитектор одобряет только при отдельном праве approve_passport,
--     которое выдаёт и отзывает владелец (grant/revoke_passport_approval,
--     журнал capability_grant_ledger);
--   * самоодобрение — только если владелец единственный активный
--     одобряющий; маркер self_approved остаётся в неизменяемой истории;
--   * новая ревизия паспорта делает недействительным одобрение прежней.
--
-- Толкование «единственного активного одобряющего», принятое для реализации
-- (DEC-043 §4, до подтверждения владельцем): решающий — автор заявки и
-- владелец проекта, и в проекте нет другого активного участника, который
-- может одобрить паспорт (другого owner_lead или архитектора с
-- approve_passport).
--
-- Серверный выбор права распространяется на обе паспортные заявки:
-- project_passport → approve_passport (проверяется по правилу выше),
-- client_passport → review_selection (как уже выбирало приложение).
-- Остальные subject_kind платформенного гейта A4 не меняются: их результат
-- не открывает ни одну продуктовую дверь.
--
-- Изменения аддитивные: новый столбец, новые функции, замена тел функций
-- с сохранением сигнатур. Прежние одобрения project_passport без ревизии
-- перестают открывать отправку КП — их нужно получить заново.

begin;

-- === Реестры: право, операции, события =====================================

do $allowlists$
declare
  v_def text;
  v_values text[];
begin
  select pg_catalog.pg_get_constraintdef(c.oid) into v_def
  from pg_catalog.pg_constraint c
  where c.conrelid = 'projectceo_foundation.project_member_capabilities'::regclass
    and c.conname = 'project_member_capabilities_capability_check';
  select pg_catalog.array_agg(distinct m[1]) into v_values
  from pg_catalog.regexp_matches(v_def, '''([a-z0-9_]+)''', 'g') m;
  if v_values is null or pg_catalog.cardinality(v_values) < 10 then
    raise exception 'PASSPORT_APPROVAL_CAPABILITY_ALLOWLIST_UNREADABLE';
  end if;
  v_values := (select pg_catalog.array_agg(distinct v order by v)
               from pg_catalog.unnest(v_values || array['approve_passport']) v);
  alter table projectceo_foundation.project_member_capabilities
    drop constraint project_member_capabilities_capability_check;
  execute pg_catalog.format(
    'alter table projectceo_foundation.project_member_capabilities '
    'add constraint project_member_capabilities_capability_check '
    'check (capability = any (%L::text[]))', v_values);

  select pg_catalog.pg_get_constraintdef(c.oid) into v_def
  from pg_catalog.pg_constraint c
  where c.conrelid = 'projectceo_product.command_records'::regclass
    and c.conname = 'command_records_operation_check';
  select pg_catalog.array_agg(distinct m[1]) into v_values
  from pg_catalog.regexp_matches(v_def, '''([a-z0-9_]+)''', 'g') m;
  if v_values is null or pg_catalog.cardinality(v_values) < 10 then
    raise exception 'PASSPORT_APPROVAL_OPERATION_ALLOWLIST_UNREADABLE';
  end if;
  v_values := (select pg_catalog.array_agg(distinct v order by v)
               from pg_catalog.unnest(v_values || array[
                 'grant_passport_approval', 'revoke_passport_approval'
               ]) v);
  alter table projectceo_product.command_records
    drop constraint command_records_operation_check;
  execute pg_catalog.format(
    'alter table projectceo_product.command_records '
    'add constraint command_records_operation_check '
    'check (operation = any (%L::text[]))', v_values);

  select pg_catalog.pg_get_constraintdef(c.oid) into v_def
  from pg_catalog.pg_constraint c
  where c.conrelid = 'projectceo_product.audit_events'::regclass
    and c.conname = 'audit_events_event_type_check';
  select pg_catalog.array_agg(distinct m[1]) into v_values
  from pg_catalog.regexp_matches(v_def, '''([a-z0-9_]+)''', 'g') m;
  if v_values is null or pg_catalog.cardinality(v_values) < 10 then
    raise exception 'PASSPORT_APPROVAL_EVENT_ALLOWLIST_UNREADABLE';
  end if;
  v_values := (select pg_catalog.array_agg(distinct v order by v)
               from pg_catalog.unnest(v_values || array[
                 'passport_approval_granted', 'passport_approval_revoked'
               ]) v);
  alter table projectceo_product.audit_events
    drop constraint audit_events_event_type_check;
  execute pg_catalog.format(
    'alter table projectceo_product.audit_events '
    'add constraint audit_events_event_type_check '
    'check (event_type = any (%L::text[]))', v_values);
end
$allowlists$;

-- === Заявка несёт ревизию паспорта ==========================================

alter table projectceo_platform.approval_requests
  add column subject_revision_no bigint
    check (subject_revision_no is null or subject_revision_no > 0);

-- NOT VALID: прежние заявки project_passport без ревизии остаются в истории,
-- но любая новая или изменённая строка project_passport обязана её нести.
alter table projectceo_platform.approval_requests
  add constraint approval_requests_passport_revision_check
  check (subject_kind <> 'project_passport' or subject_revision_no is not null)
  not valid;

-- === Внутренние помощники ===================================================

create function projectceo_platform._current_passport_revision(p_project_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $function$
  select pg_catalog.max(r.revision_no)
  from public.project_passport_revisions r
  where r.project_id = p_project_id
$function$;

-- 'owner' | 'delegated_architect' | null. Только активные членства в
-- активной организации; роль — из членства, а не из заявки.
create function projectceo_platform._passport_approval_authority(
  p_organization_id uuid,
  p_project_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
set search_path = ''
as $function$
  select case
    when pm.role = 'owner_lead' then 'owner'
    when pm.role = 'architect' and exists (
      select 1
      from projectceo_foundation.project_member_capabilities pc
      where pc.organization_id = pm.organization_id
        and pc.project_id = pm.project_id
        and pc.user_id = pm.user_id
        and pc.capability = 'approve_passport'
    ) then 'delegated_architect'
  end
  from projectceo_foundation.project_memberships pm
  join project_intelligence.organization_members om
    on om.organization_id = pm.organization_id
   and om.user_id = pm.user_id
   and om.status = 'active'
  where pm.organization_id = p_organization_id
    and pm.project_id = p_project_id
    and pm.user_id = p_user_id
    and pm.status = 'active'
$function$;

create function projectceo_platform._other_passport_approver_count(
  p_organization_id uuid,
  p_project_id uuid,
  p_user_id uuid
)
returns integer
language sql
stable
set search_path = ''
as $function$
  select pg_catalog.count(*)::integer
  from projectceo_foundation.project_memberships pm
  where pm.organization_id = p_organization_id
    and pm.project_id = p_project_id
    and pm.user_id <> p_user_id
    and pm.status = 'active'
    and projectceo_platform._passport_approval_authority(
      pm.organization_id, pm.project_id, pm.user_id
    ) is not null
$function$;

-- === Создание заявки: право одобряющего выбирает сервер =====================

create or replace function projectceo_platform_api.create_approval_request(
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
  v_kind text := btrim(coalesce(p_subject_kind, ''));
  v_capability text;
  v_revision_no bigint;
  v_result jsonb;
begin
  if v_kind = '' or char_length(v_kind) > 80 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"subjectKind"}'::jsonb);
  end if;
  if p_subject_id is null or btrim(p_subject_id) = ''
    or char_length(btrim(p_subject_id)) > 160 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"subjectId"}'::jsonb);
  end if;
  -- DEC-041 §3: для паспортных заявок значение от клиента не используется.
  if v_kind = 'project_passport' then
    v_capability := 'approve_passport';
    if btrim(p_subject_id) <> p_project_id::text then
      perform projectceo_product._raise(
        'P1111', 'validation_failed', '{"field":"subjectId"}'::jsonb);
    end if;
  elsif v_kind = 'client_passport' then
    v_capability := 'review_selection';
  else
    if p_approver_capability is null or btrim(p_approver_capability) = ''
      or char_length(btrim(p_approver_capability)) > 80 then
      perform projectceo_product._raise(
        'P1111', 'validation_failed', '{"field":"approverCapability"}'::jsonb);
    end if;
    v_capability := btrim(p_approver_capability);
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
      'subjectKind', v_kind,
      'subjectId', btrim(p_subject_id),
      'approverCapability', v_capability
    )
  );
  if v_context.replay is not null then return v_context.replay; end if;

  if v_kind = 'project_passport' then
    v_revision_no := projectceo_platform._current_passport_revision(p_project_id);
    if v_revision_no is null then
      perform projectceo_product._raise(
        'P1110', 'unsupported_source',
        '{"reason":"PASSPORT_REVISION_REQUIRED"}'::jsonb);
    end if;
  end if;

  insert into projectceo_platform.approval_requests (
    organization_id, project_id, request_id,
    subject_kind, subject_id, approver_capability, subject_revision_no,
    status, requested_by, requested_reason
  ) values (
    v_context.organization_id, p_project_id, v_request_id,
    v_kind, btrim(p_subject_id), v_capability, v_revision_no,
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
    'approverCapability', v_capability,
    'subjectRevisionNo', v_revision_no
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

-- === Подача: заявка на устаревшую ревизию не подаётся =======================

create or replace function projectceo_platform_api.submit_approval_request(
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
  if v_request.subject_kind = 'project_passport'
    and v_request.subject_revision_no is distinct from
      projectceo_platform._current_passport_revision(p_project_id) then
    perform projectceo_product._raise(
      'P1110', 'unsupported_source',
      '{"reason":"PASSPORT_REVISION_STALE"}'::jsonb);
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

-- === Решение: полномочие вычисляет сервер ===================================

create or replace function projectceo_platform_api.decide_approval_request(
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
  v_authority text;
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

  v_self := v_request.requested_by = v_context.actor_user_id;

  if v_request.subject_kind = 'project_passport' then
    v_authority := projectceo_platform._passport_approval_authority(
      v_context.organization_id, p_project_id, v_context.actor_user_id
    );
    if v_authority is null then
      perform projectceo_product._raise(
        'P1103', 'forbidden',
        '{"reason":"PASSPORT_APPROVAL_AUTHORITY_REQUIRED"}'::jsonb);
    end if;
    -- Заявка до этой миграции не несёт ревизии: решить её нельзя никак
    -- (строка не пройдёт approval_requests_passport_revision_check).
    if v_request.subject_revision_no is null then
      perform projectceo_product._raise(
        'P1110', 'unsupported_source',
        '{"reason":"PASSPORT_REVISION_STALE"}'::jsonb);
    end if;
    if p_decision = 'approved' then
      if v_request.subject_revision_no is distinct from
          projectceo_platform._current_passport_revision(p_project_id) then
        perform projectceo_product._raise(
          'P1110', 'unsupported_source',
          '{"reason":"PASSPORT_REVISION_STALE"}'::jsonb);
      end if;
      if v_self and (
        v_authority <> 'owner'
        or projectceo_platform._other_passport_approver_count(
          v_context.organization_id, p_project_id, v_context.actor_user_id
        ) > 0
      ) then
        perform projectceo_product._raise(
          'P1103', 'forbidden',
          '{"reason":"SELF_APPROVAL_REQUIRES_SOLE_OWNER"}'::jsonb);
      end if;
    end if;
  else
    -- Прочие заявки: право из заявки. Для client_passport его с этой
    -- миграции выбирает сервер (review_selection).
    perform projectceo_foundation._authorize_project_human(
      p_project_id, v_request.approver_capability
    );
  end if;

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

-- === Чтение: ревизия и её актуальность =====================================

create or replace function projectceo_platform_api.list_approval_requests(
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
  v_actor_user_id uuid;
  v_current_revision bigint;
  v_data jsonb;
begin
  if p_status is not null and p_status not in
    ('draft', 'submitted', 'approved', 'rejected') then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"status"}'::jsonb);
  end if;

  select context.organization_id, context.actor_user_id
    into v_organization_id, v_actor_user_id
  from projectceo_foundation._authorize_project_human(
    p_project_id, 'view_project'
  ) context;

  v_current_revision := projectceo_platform._current_passport_revision(p_project_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', r.request_id,
    'subjectKind', r.subject_kind,
    'subjectId', r.subject_id,
    'subjectRevisionNo', r.subject_revision_no,
    'subjectRevisionCurrent', case
      when r.subject_kind = 'project_passport' then
        r.subject_revision_no is not null
        and r.subject_revision_no = v_current_revision
    end,
    'approverCapability', r.approver_capability,
    'status', r.status,
    'requestedByCurrentActor', r.requested_by = v_actor_user_id,
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

-- === Выдача и отзыв права архитектору — только владелец =====================

create function projectceo_platform_api.grant_passport_approval(
  p_project_id uuid,
  p_user_id uuid,
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
  v_changed boolean;
  v_result jsonb;
begin
  if p_user_id is null then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"userId"}'::jsonb);
  end if;
  if p_reason is null or btrim(p_reason) = ''
    or char_length(btrim(p_reason)) > 2000 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"reason"}'::jsonb);
  end if;

  select * into v_context
  from projectceo_platform._human_command_context(
    p_project_id, 'manage_access', 'grant_passport_approval',
    p_expected_state_revision, p_idempotency_key,
    jsonb_build_object('userId', p_user_id)
  );
  if v_context.replay is not null then return v_context.replay; end if;

  if projectceo_platform._passport_approval_authority(
    v_context.organization_id, p_project_id, v_context.actor_user_id
  ) is distinct from 'owner' then
    perform projectceo_product._raise(
      'P1103', 'forbidden', '{"reason":"PROJECT_OWNER_REQUIRED"}'::jsonb);
  end if;
  if not exists (
    select 1
    from projectceo_foundation.project_memberships pm
    join project_intelligence.organization_members om
      on om.organization_id = pm.organization_id
     and om.user_id = pm.user_id
     and om.status = 'active'
    where pm.organization_id = v_context.organization_id
      and pm.project_id = p_project_id
      and pm.user_id = p_user_id
      and pm.role = 'architect'
      and pm.status = 'active'
  ) then
    perform projectceo_product._raise(
      'P1110', 'unsupported_source',
      '{"reason":"PASSPORT_APPROVAL_TARGET_NOT_ARCHITECT"}'::jsonb);
  end if;

  perform pg_catalog.set_config(
    'projectceo.capability_change_reason',
    'grant_passport_approval: ' || btrim(p_reason), true);
  insert into projectceo_foundation.project_member_capabilities (
    organization_id, project_id, user_id, capability
  ) values (
    v_context.organization_id, p_project_id, p_user_id, 'approve_passport'
  )
  on conflict do nothing;
  v_changed := found;
  perform pg_catalog.set_config('projectceo.capability_change_reason', '', true);

  v_result := jsonb_build_object(
    'userId', p_user_id, 'capability', 'approve_passport',
    'granted', true, 'changed', v_changed
  );
  return projectceo_product._complete_command(
    v_context.organization_id, p_project_id,
    'grant_passport_approval',
    v_context.key_digest, v_context.request_digest,
    'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'passport_approval_granted',
    jsonb_build_object('user_id', p_user_id, 'changed', v_changed),
    v_context.state_revision
  );
end
$function$;

create function projectceo_platform_api.revoke_passport_approval(
  p_project_id uuid,
  p_user_id uuid,
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
  v_changed boolean;
  v_result jsonb;
begin
  if p_user_id is null then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"userId"}'::jsonb);
  end if;
  if p_reason is null or btrim(p_reason) = ''
    or char_length(btrim(p_reason)) > 2000 then
    perform projectceo_product._raise(
      'P1111', 'validation_failed', '{"field":"reason"}'::jsonb);
  end if;

  select * into v_context
  from projectceo_platform._human_command_context(
    p_project_id, 'manage_access', 'revoke_passport_approval',
    p_expected_state_revision, p_idempotency_key,
    jsonb_build_object('userId', p_user_id)
  );
  if v_context.replay is not null then return v_context.replay; end if;

  if projectceo_platform._passport_approval_authority(
    v_context.organization_id, p_project_id, v_context.actor_user_id
  ) is distinct from 'owner' then
    perform projectceo_product._raise(
      'P1103', 'forbidden', '{"reason":"PROJECT_OWNER_REQUIRED"}'::jsonb);
  end if;

  perform pg_catalog.set_config(
    'projectceo.capability_change_reason',
    'revoke_passport_approval: ' || btrim(p_reason), true);
  delete from projectceo_foundation.project_member_capabilities pc
  where pc.organization_id = v_context.organization_id
    and pc.project_id = p_project_id
    and pc.user_id = p_user_id
    and pc.capability = 'approve_passport';
  v_changed := found;
  perform pg_catalog.set_config('projectceo.capability_change_reason', '', true);

  v_result := jsonb_build_object(
    'userId', p_user_id, 'capability', 'approve_passport',
    'granted', false, 'changed', v_changed
  );
  return projectceo_product._complete_command(
    v_context.organization_id, p_project_id,
    'revoke_passport_approval',
    v_context.key_digest, v_context.request_digest,
    'human', v_context.actor_id, v_context.actor_user_id,
    v_result, 'passport_approval_revoked',
    jsonb_build_object('user_id', p_user_id, 'changed', v_changed),
    v_context.state_revision
  );
end
$function$;

-- === Отправка КП: только одобрение текущей ревизии =========================

create or replace function public.guard_proposal_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_end_user boolean := current_user in ('authenticated', 'anon');
  v_requests jsonb;
begin
  if tg_op = 'INSERT' then
    if v_end_user and new.status <> 'draft' then
      raise exception using
        errcode = '42501',
        message = 'PROPOSAL_INSERT_MUST_BE_DRAFT';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_end_user and old.status <> 'draft' then
      raise exception using
        errcode = '42501',
        message = 'PROPOSAL_ISSUED_DELETE_DENIED';
    end if;
    return old;
  end if;

  if old.status <> 'draft' and (
    new.sections is distinct from old.sections
    or new.version is distinct from old.version
    or new.public_token is distinct from old.public_token
    or new.project_id is distinct from old.project_id
    or new.sent_at is distinct from old.sent_at
  ) then
    raise exception using
      errcode = '42501',
      message = 'PROPOSAL_CONTENT_LOCKED';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'sent' then
      if v_end_user then
        begin
          v_requests := projectceo_platform_api.list_approval_requests(
            new.project_id, 'approved'
          ) -> 'requests';
        exception
          when sqlstate 'P1101' or sqlstate 'P1103' or sqlstate 'P1104'
            or sqlstate 'P1109' or sqlstate 'P1111' or sqlstate '42501' then
            v_requests := null;
        end;
        -- DEC-041 §3: одобрение действует только для текущей ревизии паспорта.
        if v_requests is null
          or jsonb_typeof(v_requests) <> 'array'
          or not exists (
            select 1
            from pg_catalog.jsonb_array_elements(v_requests) request
            where request ->> 'subjectKind' = 'project_passport'
              and request ->> 'subjectId' = new.project_id::text
              and request ->> 'status' = 'approved'
              and request -> 'subjectRevisionCurrent' = 'true'::jsonb
          ) then
          raise exception using
            errcode = '42501',
            message = 'PROPOSAL_APPROVAL_REQUIRED';
        end if;
      end if;
      new.sent_at := coalesce(new.sent_at, pg_catalog.statement_timestamp());
    elsif old.status = 'sent' and new.status = 'accepted' and not v_end_user then
      null;
    else
      raise exception using
        errcode = '42501',
        message = 'PROPOSAL_STATUS_TRANSITION_DENIED',
        detail = pg_catalog.format('%s -> %s', old.status, new.status);
    end if;
  end if;

  return new;
end
$function$;

-- === Владение и гранты ======================================================

alter function projectceo_platform._current_passport_revision(uuid)
  owner to pi_table_owner;
alter function projectceo_platform._passport_approval_authority(uuid, uuid, uuid)
  owner to pi_table_owner;
alter function projectceo_platform._other_passport_approver_count(uuid, uuid, uuid)
  owner to pi_table_owner;
alter function projectceo_platform_api.grant_passport_approval(
  uuid, uuid, text, bigint, text
) owner to pi_table_owner;
alter function projectceo_platform_api.revoke_passport_approval(
  uuid, uuid, text, bigint, text
) owner to pi_table_owner;

revoke all on function projectceo_platform._current_passport_revision(uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_platform._passport_approval_authority(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_platform._other_passport_approver_count(uuid, uuid, uuid)
  from public, anon, authenticated, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_platform_api.grant_passport_approval(
  uuid, uuid, text, bigint, text
) from public, anon, service_role, pi_human_executor, pi_worker_executor;
revoke all on function projectceo_platform_api.revoke_passport_approval(
  uuid, uuid, text, bigint, text
) from public, anon, service_role, pi_human_executor, pi_worker_executor;

grant execute on function projectceo_platform_api.grant_passport_approval(
  uuid, uuid, text, bigint, text
) to authenticated;
grant execute on function projectceo_platform_api.revoke_passport_approval(
  uuid, uuid, text, bigint, text
) to authenticated;

-- === Guard ==================================================================

do $guard$
begin
  if exists (
    select 1
    from projectceo_foundation._role_capabilities('architect') rc
    where rc.capability = 'approve_passport'
  ) or exists (
    select 1
    from projectceo_foundation._role_capabilities('owner_lead') rc
    where rc.capability = 'approve_passport'
  ) then
    raise exception 'PASSPORT_APPROVAL_MUST_NOT_BE_IN_ROLE_TEMPLATE';
  end if;
  if pg_catalog.has_function_privilege(
    'anon',
    'projectceo_platform_api.grant_passport_approval(uuid,uuid,text,bigint,text)',
    'execute'
  ) then
    raise exception 'PASSPORT_APPROVAL_GRANT_REACHABLE_BY_ANON';
  end if;
end
$guard$;

commit;
